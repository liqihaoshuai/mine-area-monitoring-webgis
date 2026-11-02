/**
 * ECharts 按需注册。
 *
 * 直接 `import * as echarts from 'echarts'` 会把全部图表类型与组件打进包里
 * （本项目实测约 1 MB），而这里只用到折线图、柱状图和基础交互组件。
 * 统一从这里引入，新增图表类型时在下面的 use([...]) 里补一个即可。
 */
import { use, init, graphic } from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkPointComponent,
  MarkLineComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkPointComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export { init, graphic };
export default { init, graphic };
