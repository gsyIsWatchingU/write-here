// markdown-it 任务列表插件：把 "- [x] 事项 / - [ ] 事项" 渲染为编辑器可识别的任务列表。
// 输出与 TipTap TaskList/TaskItem 的 parseHTML 约定一致：
//   <ul data-type="taskList"><li data-type="taskItem" data-checked="true">事项</li></ul>
const CHECKBOX_PATTERN = /^\[([ xX])\](?:\s+|$)/

export function markdownTaskListPlugin(md) {
  md.core.ruler.after('inline', 'task-list', (state) => {
    const tokens = state.tokens

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'list_item_open') continue

      // 找到当前列表项内的 inline 内容
      let inline = null
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'list_item_close'; j++) {
        if (tokens[j].type === 'inline') {
          inline = tokens[j]
          break
        }
      }
      if (!inline || !Array.isArray(inline.children) || inline.children.length === 0) continue

      const first = inline.children[0]
      if (first.type !== 'text') continue
      const match = first.content.match(CHECKBOX_PATTERN)
      if (!match) continue

      first.content = first.content.slice(match[0].length)
      const checked = /[xX]/.test(match[1])

      // 标记所在列表容器为任务列表
      for (let k = i - 1; k >= 0; k--) {
        if (tokens[k].type === 'bullet_list_open' || tokens[k].type === 'ordered_list_open') {
          tokens[k].attrSet('data-type', 'taskList')
          break
        }
      }

      tokens[i].attrSet('data-type', 'taskItem')
      tokens[i].attrSet('data-checked', checked ? 'true' : 'false')
    }
  })
}
