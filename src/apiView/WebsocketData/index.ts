import { shallowRef } from 'vue'

import handler from './handler'
import WebSocket from './View.vue'

export default {
  type: 'WS',
  name: 'WS数据',
  component: shallowRef(WebSocket),
  handler,
  useTo: ['COMPONENT', 'GLOBAL'] as Array<'COMPONENT' | 'GLOBAL'>
}
