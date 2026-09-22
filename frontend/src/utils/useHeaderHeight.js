import { onBeforeUnmount, onMounted, ref } from 'vue'

// 工具栏换行、异步出现时，侧栏与标题跳转跟随实际页头高度。
export function useHeaderHeight() {
  const headerElement = ref(null)
  const headerHeight = ref(0)
  let observer
  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      headerHeight.value = Math.ceil(entry.target.getBoundingClientRect().height)
    })
    if (headerElement.value) observer.observe(headerElement.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
  return { headerElement, headerHeight }
}
