import { createRouter, createWebHashHistory } from 'vue-router';

// 路由级懒加载：首屏只下载 App + 当前页面，图表/专题图等重页面按需加载，
// 避免所有页面（含 echarts、leaflet 相关代码）在启动时一次性拉下来。
const Dashboard = () => import('../components/Dashboard.vue');
const kuangqv = () => import('../components/kuangqv.vue');
const Evaluate = () => import('../components/Evaluate.vue');
const Administrator = () => import('../components/Administrator.vue');
const ThematicMap = () => import('../components/ThematicMap.vue');
const MineChange = () => import('../components/MineChange.vue');
const EvaluationAudit = () => import('../components/EvaluationAudit.vue');
// 五个指标页共用同一个组件，靠 props 区分，避免五份近似代码各自维护
const MetricPanel = () => import('../components/MetricPanel.vue');

// hash 模式：不需要服务端 rewrite，Flask 直接托管 dist 也能刷新
const routes = [
  { path: '/', redirect: '/Dashboard' },
  { path: '/Dashboard', name: 'Dashboard', component: Dashboard },
  { path: '/kuangqv', name: 'kuangqv', component: kuangqv },
  { path: '/Audit', name: 'Audit', component: EvaluationAudit },
  { path: '/Evaluate', name: 'Evaluate', component: Evaluate },
  { path: '/Coverage', name: 'Coverage', component: MetricPanel, props: { metric: 'FVC' } },
  { path: '/vri', name: 'vri', component: MetricPanel, props: { metric: 'VRI' } },
  { path: '/ndsi', name: 'ndsi', component: MetricPanel, props: { metric: 'NDSI' } },
  { path: '/ndmi', name: 'ndmi', component: MetricPanel, props: { metric: 'NDMI' } },
  { path: '/Administrator', name: 'Administrator', component: Administrator },
  { path: '/RSEI', name: 'RSEI', component: MetricPanel, props: { metric: 'RSEI' } },
  { path: '/ChangeDetect', name: 'ChangeDetect', component: MineChange },
  { path: '/ThematicMap', name: 'ThematicMap', component: ThematicMap },
  { path: '/:pathMatch(.*)*', redirect: '/Dashboard' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
