import { ref, reactive } from 'vue';
import { listPackages, getPackagesInfo } from 'kernelsu';
import PinyinMatch from 'pinyin-match';
import { runCmd, readConfig, updateConfig } from '../utils.js';

export function useApps() {
  const apps = ref([]);
  const isLoading = ref(false);
  const loadError = ref('');
  const searchKeyword = ref('');
  const showingSystemApps = ref(true);
  const savedBlacklist = ref(new Set());
  const activityEntries = ref(new Set());

  /** 每个 app 条目结构: { packageName, appLabel, isSystem, uid, checked, hasActivities } */

  async function load() {
    isLoading.value = true;
    loadError.value = '';
    try {
      const cfg = await readConfig();
      const allSaved = Array.isArray(cfg.blacklist_apps) ? cfg.blacklist_apps : [];
      savedBlacklist.value = new Set(allSaved);
      const savedPkgSet = new Set(allSaved.filter(e => !e.includes('/')));
      activityEntries.value = new Set(allSaved.filter(e => e.includes('/')));

      let infoList = [];
      try {
        const pkgs = await listPackages();
        if (pkgs && pkgs.length > 0) infoList = await getPackagesInfo(pkgs);
        else throw new Error('no pkgs');
      } catch {
        console.log('[DEBUG] 使用模拟数据');
        infoList = Array.from({ length: 150 }, (_, i) => ({
          packageName: `com.mock.app${i}`,
          appLabel: i % 10 === 0 ? `测试应用 ${i} (含抖音关键字)` : `模拟应用 ${i}`,
          isSystem: i % 5 === 0,
          uid: 10000 + i,
        }));
      }

      if (!showingSystemApps.value) infoList = infoList.filter(a => !a.isSystem);

      infoList.sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
        return (a.appLabel || '').localeCompare(b.appLabel || '');
      });

      const seenUids = new Set();
      infoList = infoList.filter(a => {
        if (a.uid == null) return true;
        if (seenUids.has(a.uid)) return false;
        seenUids.add(a.uid); return true;
      });

      apps.value = infoList.map(a => reactive({
        packageName: a.packageName,
        appLabel: a.appLabel || 'Unknown',
        isSystem: a.isSystem,
        uid: a.uid,
        checked: savedPkgSet.has(a.packageName),
        expanded: false,
      }));

      _reorder();
    } catch (e) {
      loadError.value = e.message || String(e);
    } finally {
      isLoading.value = false;
    }
  }

  function _reorder() {
    apps.value.sort((a, b) => {
      const stateA = a.checked ? 2 : (hasActivity(a.packageName) ? 1 : 0);
      const stateB = b.checked ? 2 : (hasActivity(b.packageName) ? 1 : 0);
      return stateB - stateA;
    });
  }

  function hasActivity(pkg) {
    return [...activityEntries.value].some(e => e.startsWith(pkg + '/'));
  }

  function getActivities(pkg) {
    return [...activityEntries.value].filter(e => e.startsWith(pkg + '/'));
  }

  function addActivity(entry) {
    activityEntries.value.add(entry);
    _reorder();
  }

  function removeActivity(entry) {
    activityEntries.value.delete(entry);
    _reorder();
  }

  async function save(toast) {
    toast('保存中...');
    const selectedPkgs = apps.value.filter(a => a.checked).map(a => a.packageName);
    const allEntries = [...selectedPkgs, ...activityEntries.value];
    const res = await updateConfig({ blacklist_apps: allEntries });
    if (res.errno === 0) {
      savedBlacklist.value = new Set(allEntries);
      toast('黑名单保存成功');
    } else {
      toast('保存失败: ' + res.stderr);
    }
  }

  function onCheckboxChange() { _reorder(); }

  function toggleSystemApps() {
    showingSystemApps.value = !showingSystemApps.value;
    load();
  }

  function selectAll() { apps.value.forEach(a => { a.checked = true; }); _reorder(); }
  function selectNone() { apps.value.forEach(a => { a.checked = false; }); _reorder(); }
  function invertSelection() { apps.value.forEach(a => { a.checked = !a.checked; }); _reorder(); }

  const smartKeywords = ['抖音', 'tiktok', '爱奇艺', '优酷', '腾讯视频', '哔哩', 'bilibili',
    'youku', 'iqiyi', '芒果', '西瓜', '快手', 'kuaishou', '小红书',
    'netflix', 'youtube', 'hulu', 'disney', 'prime', '相册', 'gallery', 'photos', 'x'];

  function smartSelect() {
    apps.value.forEach(a => {
      const name = (a.appLabel || '').toLowerCase();
      const pkg = (a.packageName || '').toLowerCase();
      for (const kw of smartKeywords) {
        if (kw === 'x') {
          if (name === 'x' || name === 'x (twitter)') { a.checked = true; break; }
        } else if (name.includes(kw) || pkg.includes(kw)) { a.checked = true; break; }
      }
    });
    _reorder();
  }

  // 过滤后的列表
  function getFilteredApps() {
    const kw = searchKeyword.value.trim().toLowerCase();
    if (!kw) return apps.value;
    return apps.value.filter(a => {
      const pkg = a.packageName.toLowerCase();
      return pkg.includes(kw) || PinyinMatch.match(a.appLabel, kw);
    });
  }

  return {
    apps, isLoading, loadError, searchKeyword, showingSystemApps,
    savedBlacklist, activityEntries,
    load, save,
    hasActivity, getActivities, addActivity, removeActivity,
    onCheckboxChange,
    toggleSystemApps, selectAll, selectNone, invertSelection, smartSelect,
    getFilteredApps,
  };
}
