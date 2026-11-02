import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import {
  // 只注册项目实际用到的组件：全量 app.use(ElementPlus) 会把整套组件打进包里
  ElAside,
  ElButton,
  ElContainer,
  ElDialog,
  ElForm,
  ElFormItem,
  ElHeader,
  ElIcon,
  ElInput,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElMenuItemGroup,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSlider,
  ElSubMenu,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
  ElConfigProvider,
  ElMessage,
  ElMessageBox,
  ElNotification,
  ElLoading,
} from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import {
  Avatar,
  CircleCheck,
  DataAnalysis,
  DataLine,
  DocumentChecked,
  InfoFilled,
  MapLocation,
  Picture,
  User,
  UserFilled,
  VideoPause,
  VideoPlay,
} from '@element-plus/icons-vue';

import 'element-plus/dist/index.css';
import 'leaflet/dist/leaflet.css';
import './style.css';

import App from './App.vue';
import router from './router';

// 语言包通过 ElConfigProvider 下发给子组件（它只渲染 slot，不额外包一层 DOM）
const Root = {
  name: 'Root',
  render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App)),
};

const app = createApp(Root);

const COMPONENTS = {
  ElAside,
  ElButton,
  ElContainer,
  ElDialog,
  ElForm,
  ElFormItem,
  ElHeader,
  ElIcon,
  ElInput,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElMenuItemGroup,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSlider,
  ElSubMenu,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
};
Object.entries(COMPONENTS).forEach(([name, component]) => {
  app.component(name, component);
});

// 图标按需注册：模板里用 <el-icon><User /></el-icon>，按钮 icon 用字符串名
const ICONS = {
  Avatar,
  CircleCheck,
  DataAnalysis,
  DataLine,
  DocumentChecked,
  InfoFilled,
  MapLocation,
  Picture,
  User,
  UserFilled,
  VideoPause,
  VideoPlay,
};
Object.entries(ICONS).forEach(([name, component]) => {
  app.component(name, component);
});

app.use(createPinia());
app.use(router);

// 保留 Vue 2 + Element UI 时代的调用习惯：this.$message.success(...) / this.$confirm(...)
app.config.globalProperties.$message = ElMessage;
app.config.globalProperties.$msgbox = ElMessageBox;
app.config.globalProperties.$alert = ElMessageBox.alert;
app.config.globalProperties.$confirm = ElMessageBox.confirm;
app.config.globalProperties.$prompt = ElMessageBox.prompt;
app.config.globalProperties.$notify = ElNotification;
app.config.globalProperties.$loading = ElLoading.service;

app.mount('#app');
