<template>
  <div>
    <div
      id="editor"
      ref="editor"
      v-contextmenu="contextMenus"
      class="editor edit"
      :style="bgStyle"
      @mousedown.left="handleMouseDown"
      @drop="handleDrop"
      @dragover="handleDragOver"
      @mouseup="deselectCurComponent"
    >
      <!-- 网格线 -->
      <Grid />

      <!-- 标尺 -->
      <Ruler
        :width="canvasStyleData.width"
        :height="canvasStyleData.height"
        :isShowReferLine="isShowReferLine"
      />

      <!--页面组件列表展示-->
      <template v-for="(item, index) in componentData" :key="item.id">
        <Shape
          v-if="canvasState.isEditMode && item.display"
          :id="'shape' + item.id"
          :defaultStyle="item.style"
          :style="getShapeStyle(item.style)"
          :active="item.id === (curComponent || {}).id"
          :info="item"
          :class="{ lock: item.locked }"
          :index="index"
        >
          <component
            :is="item.component"
            :id="'component' + item.id"
            class="component"
            :style="getComponentShapeStyle(item)"
            :component="item"
          />
        </Shape>
      </template>
      <!-- 标线 -->
      <MarkLine />

      <!-- 选中区域 -->
      <Area />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CustomComponent } from '@open-data-v/base'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import Area from '../editor/Area.vue'
import Grid from '../editor/Grid.vue'
import MarkLine from '../editor/MarkLine.vue'
import Ruler from '../editor/Ruler.vue'
import Shape from '../editor/Shape'
import { DataMode, EditMode } from '../enum'
import { useActionState, useCanvasState, useClipBoardState } from '../state'
import type { ContextmenuItem, Location, Vector } from '../type'
import {
  backgroundToCss,
  buildDataHandler,
  createComponent,
  filterStyle,
  getComponentInstance,
  getComponentShapeStyle,
  systemLogger,
  uuid
} from '../utils'

const actionState = useActionState()
const clipBoardState = useClipBoardState()
const canvasState = useCanvasState()

const getShapeStyle = (style) => {
  return filterStyle(style, ['top', 'left', 'width', 'height', 'rotate'])
}

const clearCanvas = () => {
  canvasState.clearCanvas()
}

const paste = (_: HTMLElement, event: MouseEvent) => {
  const editorRectInfo = document.querySelector('#editor')!.getBoundingClientRect()
  const y = event.pageY - editorRectInfo.top
  const x = event.pageX - editorRectInfo.left
  clipBoardState.paste(true, x, y)
}

const contextMenus = (): ContextmenuItem[] => {
  return [
    {
      text: '粘贴',
      subText: 'Ctrl + V',
      handler: paste
    },
    {
      text: '清空画布',
      subText: '',
      handler: clearCanvas
    }
  ]
}

onMounted(() => {
  systemLogger.debug('进入编辑模式')
  canvasState.setEditMode(EditMode.EDIT)
  document.addEventListener('paste', pasteComponent)
  document.addEventListener('copy', copyComponent)
})

onUnmounted(() => {
  systemLogger.debug('进入预览模式')
  canvasState.setEditMode(EditMode.PREVIEW)
  document.removeEventListener('paste', pasteComponent)
  document.removeEventListener('copy', copyComponent)
  canvasState.clearCanvas()
})

const componentData = computed(() => {
  return canvasState.componentData
})

const canvasStyleData = computed(() => canvasState.canvasStyleData)
const curComponent = computed(() => canvasState.activeComponent)

const bgStyle = computed<Record<string, string>>(() => {
  const backgroundStyle = backgroundToCss(canvasStyleData.value.background)
  const style = {
    ...canvasStyleData.value,
    ...backgroundStyle
  }
  return filterStyle(style, [
    'width',
    'height',
    'backgroundImage',
    'backgroundSize',
    'backgroundColor'
  ])
})

const copyComponent = () => {
  if (canvasState.activeComponent) {
    clipBoardState.copy(canvasState.activeComponent)
  }
}

const pasteComponent = async (event: ClipboardEvent) => {
  if (event.clipboardData) {
    const textData = event.clipboardData.getData('text')
    try {
      const componentData = JSON.parse(textData)
      await canvasState.loadComponetClazz(componentData.component)
      const component: CustomComponent = createComponent(componentData)
      if (component) {
        component.changeStyle(['position', 'top'], component.positionStyle.top + 10)
        component.changeStyle(['position', 'left'], component.positionStyle.left + 10)
        component.id = uuid()
        clipBoardState.copy(component)
        event.preventDefault()
        event.stopPropagation()
        canvasState.appendComponent(component)
      }
    } catch (_) {}
  }
}

const editorX = ref<number>(0)
const editorY = ref<number>(0)
const start = reactive<Vector>({
  x: 0,
  y: 0
})

const editor = ref<ElRef>(null)
const isShowReferLine = ref<boolean>(true)
const handleMouseDown = (e: MouseEvent) => {
  // 阻止默认事件，防止拖拽时出现拖拽图标
  canvasState.deactivateComponent()
  e.preventDefault()
  e.stopPropagation()
  actionState.setHidden()
  // 获取编辑器的位移信息，每次点击时都需要获取一次。主要是为了方便开发时调试用。
  const rectInfo = editor.value?.getBoundingClientRect()
  editorX.value = rectInfo!.x
  editorY.value = rectInfo!.y
  const startX = e.clientX
  const startY = e.clientY
  start.x = (startX - editorX.value) / canvasState.scale
  start.y = (startY - editorY.value) / canvasState.scale

  const move = (moveEvent: MouseEvent) => {
    moveEvent.preventDefault()
    moveEvent.stopPropagation()

    if (moveEvent.clientX < startX) {
      start.x = (moveEvent.clientX - editorX.value) / canvasState.scale
    }
    if (moveEvent.clientY < startY) {
      start.y = (moveEvent.clientY - editorY.value) / canvasState.scale
    }
    const width = Math.abs(moveEvent.clientX - startX) / canvasState.scale
    const height = Math.abs(moveEvent.clientY - startY) / canvasState.scale

    actionState.setPostion({ left: start.x, top: start.y, width, height })
  }
  const up = (UpMoveEvent: MouseEvent) => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    if (UpMoveEvent.clientX == startX && UpMoveEvent.clientY == startY) {
      actionState.setHidden()
      return
    }

    const selectedRect: Location = {
      left: Math.round(actionState.style.left),
      top: Math.round(actionState.style.top),
      right: actionState.style.left + actionState.style.width,
      bottom: actionState.style.top + actionState.style.height
    }

    actionState.setSelectComponents(selectedRect)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

const handleDrop = async (e) => {
  e.preventDefault()
  e.stopPropagation()
  const componentName = e.dataTransfer.getData('componentName')
  if (!componentName) {
    return
  }
  await canvasState.loadComponetClazz(componentName)
  const component: CustomComponent = getComponentInstance({ component: componentName })
  if (!component) {
    return
  }

  if (component.dataMode === DataMode.UNIVERSAL) {
    buildDataHandler(component)
  }

  const editorRectInfo = document.querySelector('#editor')!.getBoundingClientRect()
  const y = Math.round((e.pageY - editorRectInfo.top) / canvasState.scale)
  const x = Math.round((e.pageX - editorRectInfo.left) / canvasState.scale)
  component.changeStyle(['position', 'top'], y)
  component.changeStyle(['position', 'left'], x)
  canvasState.appendComponent(component)
}

const handleDragOver = (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

const deselectCurComponent = () => {
  if (!canvasState.activeComponent) {
    canvasState.activateComponent(undefined)
  }
}
</script>

<style lang="less" scoped>
.editor {
  @apply relative m-auto;
}

.edit .component {
  @apply w-full h-full;
  position: static !important;
}
</style>
