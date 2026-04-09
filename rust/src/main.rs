//! lumipro: 带防抖的 inotify 监听工具
//!
//! 用法: lumipro [--debug] [--debounce <ms>] <handler> <path:events> [<path:events>...]
//!
//! 事件字母与 Android toybox inotifyd 完全兼容:
//!   a=ACCESS      c=MODIFY       e=ATTRIB       w=CLOSE_WRITE
//!   0=CLOSE_NOWRITE  r=OPEN      n=CREATE       d=DELETE
//!   D=DELETE_SELF M=MOVE_SELF   m=MOVED_TO     y=MOVED_FROM
//!   u=UNMOUNT     o=OVERFLOW     x=IGNORED      *=ALL
//!
//! 防抖机制: 在指定窗口期内多次触发时，只执行最后一次；handler 执行期间
//! 积压的事件（如亮度渐变写入）在 handler 返回后统一丢弃。

#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux {
    use std::collections::HashMap;
    use std::os::unix::io::AsRawFd;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{Duration, Instant};

    use inotify::{EventMask, Inotify, WatchDescriptor, WatchMask};

    fn letters_to_mask(letters: &str) -> WatchMask {
        let mut mask = WatchMask::empty();
        for c in letters.chars() {
            mask |= match c {
                'a' => WatchMask::ACCESS,
                'c' => WatchMask::MODIFY,          // toybox: modified
                'e' => WatchMask::ATTRIB,          // toybox: metadata change
                'w' => WatchMask::CLOSE_WRITE,     // toybox: closed (writable)
                '0' => WatchMask::CLOSE_NOWRITE,   // toybox: closed (unwritable)
                'r' => WatchMask::OPEN,            // toybox: opened
                'n' => WatchMask::CREATE,
                'd' => WatchMask::DELETE,
                'D' => WatchMask::DELETE_SELF,
                'M' => WatchMask::MOVE_SELF,
                'm' => WatchMask::MOVED_TO,        // toybox: moved in
                'y' => WatchMask::MOVED_FROM,      // toybox: moved out
                'u' => WatchMask::empty(),         // toybox: unmounted — 内核产生，不设置 watch mask
                '*' => WatchMask::ALL_EVENTS,
                // 'o'=overflow 'x'=ignored 为内核产生，不设置 watch mask
                _ => WatchMask::empty(),
            };
        }
        mask
    }

    fn mask_to_letters(mask: EventMask) -> String {
        let mut s = String::new();
        if mask.contains(EventMask::ACCESS) { s.push('a'); }
        if mask.contains(EventMask::MODIFY) { s.push('c'); }
        if mask.contains(EventMask::ATTRIB) { s.push('e'); }
        if mask.contains(EventMask::CLOSE_WRITE) { s.push('w'); }
        if mask.contains(EventMask::CLOSE_NOWRITE) { s.push('0'); }
        if mask.contains(EventMask::OPEN) { s.push('r'); }
        if mask.contains(EventMask::MOVED_FROM) { s.push('y'); }
        if mask.contains(EventMask::MOVED_TO) { s.push('m'); }
        if mask.contains(EventMask::CREATE) { s.push('n'); }
        if mask.contains(EventMask::DELETE) { s.push('d'); }
        if mask.contains(EventMask::DELETE_SELF) { s.push('D'); }
        if mask.contains(EventMask::MOVE_SELF) { s.push('M'); }
        if mask.contains(EventMask::UNMOUNT) { s.push('u'); }
        if mask.contains(EventMask::Q_OVERFLOW) { s.push('o'); }
        if mask.contains(EventMask::IGNORED) { s.push('x'); }
        if s.is_empty() { s.push('?'); }
        s
    }

    /// 对 inotify fd 执行 poll，返回是否有可读事件。
    /// timeout_ms = -1 为永久阻塞，0 为立即返回。
    fn poll_readable(fd: i32, timeout_ms: i32) -> bool {
        let mut pfd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: pfd 为合法的 pollfd，nfds=1，fd 由 Inotify 保证有效。
        unsafe { libc::poll(&mut pfd as *mut libc::pollfd, 1, timeout_ms) > 0 }
    }

    struct Pending {
        triggered_at: Instant,
        event_letters: String,
        path: PathBuf,
    }

    pub fn run() {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut idx = 0;

        let mut debounce_ms: u64 = 300;
        let mut debug = false;

        loop {
            match args.get(idx).map(String::as_str) {
                Some("--debug") => { debug = true; idx += 1; }
                Some("--debounce") => {
                    idx += 1;
                    debounce_ms = args.get(idx).and_then(|s| s.parse().ok()).unwrap_or(300);
                    idx += 1;
                }
                _ => break,
            }
        }

        let handler = match args.get(idx) {
            Some(h) => h.clone(),
            None => {
                eprintln!("Usage: lumipro [--debounce <ms>] <handler> <path:events>...");
                std::process::exit(1);
            }
        };
        idx += 1;

        if idx >= args.len() {
            eprintln!("Error: no watch targets specified");
            std::process::exit(1);
        }

        let mut inotify = Inotify::init().expect("inotify_init failed");

        // 设置 O_NONBLOCK，使 read_events 在无数据时立即返回 WouldBlock，
        // 避免 drain 循环阻塞。
        let inotify_fd = inotify.as_raw_fd();
        unsafe {
            let flags = libc::fcntl(inotify_fd, libc::F_GETFL, 0);
            libc::fcntl(inotify_fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }

        let mut watches: HashMap<WatchDescriptor, (PathBuf, String)> = HashMap::new();
        for spec in &args[idx..] {
            let (path_str, letters) = match spec.find(':') {
                Some(i) => (&spec[..i], &spec[i + 1..]),
                None => (spec.as_str(), "c"),
            };
            let path = PathBuf::from(path_str);
            let mask = letters_to_mask(letters);
            match inotify.watches().add(&path, mask) {
                Ok(wd) => {
                    if debug {
                        eprintln!("[lumipro] watching: {} events: {}", path_str, letters);
                    }
                    watches.insert(wd, (path, letters.to_string()));
                }
                Err(e) => {
                    eprintln!("Failed to watch {path_str}: {e}");
                    std::process::exit(1);
                }
            }
        }

        if debug {
            eprintln!("[lumipro] debounce={}ms handler={}", debounce_ms, handler);
        }

        let debounce = Duration::from_millis(debounce_ms);
        let mut pending: Option<Pending> = None;
        let mut buffer = [0u8; 4096];

        loop {
            // ── 1. 计算本次 poll 超时 ──────────────────────────────────────────
            let timeout_ms: i32 = match &pending {
                // 无待触发事件：永久阻塞直到新事件到来
                None => -1,
                Some(p) => {
                    let elapsed = p.triggered_at.elapsed();
                    if elapsed >= debounce {
                        0 // 防抖窗口已过期，跳过 poll 直接触发
                    } else {
                        (debounce - elapsed).as_millis().min(i32::MAX as u128) as i32
                    }
                }
            };

            // timeout_ms == 0 时跳过 poll（防抖已到期），直接进入触发分支
            let has_data = timeout_ms != 0 && poll_readable(inotify_fd, timeout_ms);

            if has_data {
                // ── 2. 有新事件：读取并重置防抖计时器 ───────────────────────
                match inotify.read_events(&mut buffer) {
                    Ok(events) => {
                        for event in events {
                            if let Some((path, _)) = watches.get(&event.wd) {
                                let letters = mask_to_letters(event.mask);
                                if debug {
                                    eprintln!("[lumipro] event: {} path: {}", letters, path.display());
                                }
                                pending = Some(Pending {
                                    triggered_at: Instant::now(),
                                    event_letters: letters,
                                    path: path.clone(),
                                });
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => eprintln!("read_events: {e}"),
                }
            } else if let Some(p) = pending.take() {
                // ── 3. 防抖窗口结束：同步执行 handler ───────────────────────
                if debug {
                    eprintln!("[lumipro] debounce fired → handler: {} {}", p.event_letters, p.path.display());
                }
                let _ = Command::new(&handler)
                    .arg(&p.event_letters)
                    .arg(&p.path)
                    .status();

                // ── 4. 丢弃 handler 执行期间（亮度渐变写入）积压的全部事件 ─
                let mut drained = 0usize;
                loop {
                    match inotify.read_events(&mut buffer) {
                        Ok(events) => {
                            for _ in events { drained += 1; }
                        }
                        Err(_) => break, // WouldBlock：积压已清空
                    }
                }
                if debug && drained > 0 {
                    eprintln!("[lumipro] drain: discarded {} event(s)", drained);
                }
            }
        }
    }
}

fn main() {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    linux::run();

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        eprintln!("lumipro: only supported on Linux/Android");
        std::process::exit(1);
    }
}
