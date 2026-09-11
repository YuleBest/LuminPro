// @material/web 组件的唯一引入入口：只 import 本项目实际用到的组件，避免打包体积膨胀。
// 说明：Material Web Components 官方处于维护模式，不包含 M3 Expressive 的动效；
// 导航栏（navigationbar/navigationtab）位于 labs/ 目录。

// 按钮与图标按钮
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/button/text-button.js'
import '@material/web/iconbutton/icon-button.js'

// 输入类
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/select/outlined-select.js'
import '@material/web/select/select-option.js'
import '@material/web/switch/switch.js'
import '@material/web/slider/slider.js'
import '@material/web/checkbox/checkbox.js'

// 容器与浮层
import '@material/web/dialog/dialog.js'
import '@material/web/menu/menu.js'
import '@material/web/menu/menu-item.js'
import '@material/web/divider/divider.js'

// 反馈
import '@material/web/chips/chip-set.js'
import '@material/web/chips/filter-chip.js'

// 导航（labs）
import '@material/web/labs/navigationbar/navigation-bar.js'
import '@material/web/labs/navigationtab/navigation-tab.js'
