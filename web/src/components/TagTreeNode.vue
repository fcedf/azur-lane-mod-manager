<template>
  <div>
    <div
      class="tag-item"
      :class="{
        active: activeName === node.name,
        'is-dragging': dnd.dragging?.id === node.id,
        'drop-valid': dnd.started && dnd.overNode?.id === node.id && dnd.valid,
      }"
      :style="{ paddingLeft: 12 + depth * 18 + 'px' }"
      :data-tag-id="node.id"
      @click="onSelect"
      @mousedown="onMouseDown"
      @contextmenu.prevent="$emit('menu', $event, node)"
    >
      <span
        v-if="node.children?.length"
        class="caret"
        @click.stop="toggle"
      >
        <el-icon><ArrowRight v-if="!open" /><ArrowDown v-else /></el-icon>
      </span>
      <span v-else class="caret caret-leaf"><el-icon><PriceTag /></el-icon></span>
      <span class="tag-name">{{ node.name }}</span>
      <el-tag size="small" effect="plain" class="cnt">{{ node.fileCount }}</el-tag>
    </div>
    <div v-show="open && node.children?.length" class="tag-children">
      <tag-tree-node
        v-for="c in node.children"
        :key="c.id"
        :node="c"
        :depth="depth + 1"
        :active-name="activeName"
        @select="n => $emit('select', n)"
        @menu="(e, n) => $emit('menu', e, n)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ArrowRight, ArrowDown, PriceTag } from '@element-plus/icons-vue';
import { bindTagDrag, dndState as dnd } from './tagDnd.js';

defineOptions({ name: 'TagTreeNode' });
const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  activeName: { type: String, default: '' },
});
const emit = defineEmits(['select', 'menu']);

// 默认展开第一层；深层默认折叠（标签多时更清爽）
const open = ref(props.depth < 1);
function toggle() {
  open.value = !open.value;
}

function onSelect() {
  emit('select', props.node.name);
}

// 长按拖拽：由父组件 provide 的 dndDeps 提供树引用与回调
import { inject } from 'vue';
const dndDeps = inject('tagDndDeps', null);
function onMouseDown(e) {
  if (!dndDeps || e.button !== 0) return;
  // 点展开箭头 / 数字角标时不进入拖拽
  if (e.target.closest('.caret')) return;
  bindTagDrag({ ...props.node, parentId: dndDeps.parentOf(props.node.id) }, e.currentTarget, e, dndDeps);
}
</script>

<style scoped>
.tag-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  margin: 1px 6px;
  border-radius: 6px;
  cursor: pointer;
  color: #303133;
  font-size: 14px;
  user-select: none;
  transition: background 0.12s ease;
}
.tag-item:hover {
  background: #f0f5ff;
}
.tag-item.active {
  background: #dceaff;
  color: #1d6fe0;
  font-weight: 600;
}
.caret {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 12px;
  width: 16px;
  color: #909399;
}
.caret-leaf {
  font-size: 12px;
  opacity: 0.55;
}
.tag-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cnt {
  flex-shrink: 0;
}
.tag-item.is-dragging {
  opacity: 0.4;
}
.tag-item.drop-valid {
  background: #e6f4ff;
}
</style>
