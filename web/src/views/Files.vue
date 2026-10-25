<template>
  <div class="files-page">
    <el-row :gutter="12" class="full tag-layout">
      <!-- 左侧：标签分类（固定 190px） -->
      <el-col :span="4" class="tag-col">
        <el-card shadow="never" class="side-card">
          <template #header>
            <div class="card-header">
              <span>分类（标签）</span>
              <el-button link type="primary" @click="openCreateTag">
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>
          </template>

          <!-- 全部文件 -->
          <div
            class="tag-item"
            :class="{ active: !searchMode && currentTag === '' }"
            @click="selectTag('')"
          >
            <el-icon color="#606266"><Files /></el-icon>
            <span class="tag-name">全部文件</span>
            <el-tag size="small" effect="plain">{{ totalCount }}</el-tag>
          </div>

          <!-- 标签分类（支持父子层级，点父标签聚合子标签文件） -->
          <tag-tree-node
            v-for="t in tagTree"
            :key="t.id"
            :node="t"
            :depth="0"
            :active-name="!searchMode ? currentTag : ''"
            @select="selectTag"
            @menu="tagMenu"
          />

          <el-empty v-if="!tagTree.length" description="还没有分类，点 + 新建" :image-size="60" />
        </el-card>
      </el-col>

      <!-- 右侧主区域（自适应占满） -->
      <el-col :span="20" class="content-col">
        <!-- 搜索结果模式 -->
        <el-card v-if="searchMode" shadow="never">
          <template #header>
            <div class="card-header">
              <span>全局搜索：“{{ searchKeyword }}”（共 {{ searchResults.length }} 个结果）</span>
              <el-button link @click="exitSearch">返回</el-button>
            </div>
          </template>
          <file-table :rows="sortedSearchResults" @action="onFileAction" />
          <el-empty v-if="!searchResults.length" description="没有找到匹配的文件" />
        </el-card>

        <!-- 标签浏览模式 -->
        <el-card v-else shadow="never">
          <template #header>
            <div class="header-bar">
              <div class="view-title">
                <el-icon v-if="currentTag" :color="currentTagColor" :size="20"><PriceTag /></el-icon>
                <el-icon v-else :size="20"><Files /></el-icon>
                {{ currentTag || '全部文件' }}
                <el-tag effect="plain" round>{{ files.length }} 个</el-tag>
              </div>
            </div>
          </template>

          <!-- 工具栏 -->
          <div class="toolbar">
            <el-button type="primary" :icon="Upload" @click="triggerUpload">
              上传{{ currentTag ? `到「${currentTag}」` : '文件' }}
            </el-button>
            <el-button type="success" plain :icon="Box" @click="triggerScanFolder">
              扫描文件夹压缩包
            </el-button>
            <el-button
              type="warning"
              plain
              :disabled="!selectedFiles.length"
              @click="openBatchTags"
            >
              <el-icon class="el-icon--left"><PriceTag /></el-icon>
              批量标签{{ selectedFiles.length ? `（${selectedFiles.length}）` : '' }}
            </el-button>
            <el-button
              type="primary"
              plain
              :loading="batchDownloading"
              :disabled="!selectedFiles.length"
              @click="submitBatchDownload"
            >
              <el-icon class="el-icon--left"><Download /></el-icon>
              打包下载{{ selectedFiles.length ? `（${selectedFiles.length}）` : '' }}
            </el-button>
            <el-button
              type="warning"
              plain
              :disabled="!selectedArchiveCount"
              @click="submitBatchInject"
            >
              <el-icon class="el-icon--left"><Cpu /></el-icon>
              批量注入{{ selectedArchiveCount ? `（${selectedArchiveCount}）` : '' }}
            </el-button>
            <el-button
              type="danger"
              plain
              :disabled="!selectedFiles.length"
              @click="submitBatchDelete"
            >
              <el-icon class="el-icon--left"><Delete /></el-icon>
              批量删除{{ selectedFiles.length ? `（${selectedFiles.length}）` : '' }}
            </el-button>
            <input
              id="folder-picker"
              type="file"
              class="hidden-folder-input"
              webkitdirectory
              directory
              multiple
              @change="onFolderPicked"
            />
            <!-- 第二行：类型筛选 + 排序，独占一行靠右，不受上方按钮数量影响 -->
            <div class="filter-bar">
              <el-radio-group v-model="typeFilter" size="default">
                <el-radio-button label="">全部</el-radio-button>
                <el-radio-button label="doc">文档</el-radio-button>
                <el-radio-button label="image">图片</el-radio-button>
                <el-radio-button label="video">视频</el-radio-button>
                <el-radio-button label="audio">音频</el-radio-button>
                <el-radio-button label="archive">压缩包</el-radio-button>
              </el-radio-group>

              <!-- 排序：字段选择 + 独立方向按钮 -->
              <div class="sort-bar">
                <span class="sort-label">排序：</span>
                <el-select v-model="sortField" size="default" style="width: 100px">
                  <el-option label="名称" value="name" />
                  <el-option label="大小" value="size" />
                  <el-option label="上传日期" value="date" />
                  <el-option label="原始日期" value="origin" />
                </el-select>
                <el-button
                  size="default"
                  :type="sortOrder === 'desc' ? 'warning' : 'primary'"
                  plain
                  @click="toggleSortOrder"
                >
                  {{ sortOrder === 'desc' ? '降序' : '升序' }}
                  <el-icon class="el-icon--right">
                    <component :is="sortOrder === 'desc' ? 'ArrowDown' : 'ArrowUp'" />
                  </el-icon>
                </el-button>
              </div>
            </div>
          </div>

          <!-- 拖拽上传区 -->
          <el-upload
            drag
            multiple
            :show-file-list="false"
            :auto-upload="false"
            :on-change="onPickFile"
            class="upload-zone"
          >
            <el-icon class="el-icon--upload"><upload-filled /></el-icon>
            <div class="el-upload__text">
              拖拽文件到此处，或<em>点击上传</em>（上传时可选择存放子目录）
            </div>
          </el-upload>

          <el-progress v-if="uploadProgress" :percentage="uploadProgress" :stroke-width="6" style="margin: 8px 0" />

          <!-- 文件列表 -->
          <file-table
            ref="mainTableRef"
            :rows="sortedFiles"
            selectable
            @action="onFileAction"
            @selection-change="onFileSelectionChange"
          />
          <el-empty v-if="!filteredFiles.length" :description="currentTag ? `「${currentTag}」分类下还没有文件` : '还没有文件，快上传吧'" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 上传：选择存放位置 -->
    <el-dialog v-model="uploadTargetVisible" title="上传到…" width="600px"
      :close-on-click-modal="false">
      <el-form label-width="72px" @submit.prevent>
        <subdir-picker ref="uploadPickerRef" v-model="uploadSubdir" />
        <el-form-item label="待上传">
          <el-tag type="info">{{ pendingFiles.length }} 个文件</el-tag>
          <el-scrollbar max-height="140px" style="margin-top:6px">
            <div v-for="(f, i) in pendingFiles" :key="i" class="pend-line">
              <el-icon><Document /></el-icon>{{ f.name }}
              <span class="pend-size">{{ formatBytes(f.size) }}</span>
            </div>
          </el-scrollbar>
        </el-form-item>
        <el-progress v-if="uploadProgress" :percentage="uploadProgress" :stroke-width="8" text-inside />
      </el-form>
      <template #footer>
        <el-button @click="cancelUploadTarget">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="confirmUploadTarget">开始上传</el-button>
      </template>
    </el-dialog>

    <!-- 新建/编辑标签弹窗 -->
    <el-dialog v-model="tagDialogVisible" :title="tagDialogTitle" width="420px">
      <el-form label-width="80px">
        <el-form-item v-if="editingTag.parentName" label="所属父级">
          <el-tag type="info" effect="plain">{{ editingTag.parentName }}</el-tag>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editingTag.name" placeholder="分类名称" maxlength="30" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="editingTag.color" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tagDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitTag">保存</el-button>
      </template>
    </el-dialog>

    <!-- 移动标签层级弹窗 -->
    <el-dialog v-model="moveDialogVisible" title="移动分类到…" width="400px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="分类">
          <el-tag :style="tagStyle(moveTag)">{{ moveTag?.name }}</el-tag>
        </el-form-item>
        <el-form-item label="新父级">
          <el-tree-select
            v-model="moveTargetId"
            :data="moveTreeData"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            clearable
            filterable
            placeholder="顶级（不选父级）"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" show-icon title="不能移动到它自己的子分类下面。" />
      <template #footer>
        <el-button @click="moveDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitMove">确定</el-button>
      </template>
    </el-dialog>

    <!-- 标签右键菜单 -->
    <ul
      v-if="tagMenuVisible"
      class="tag-context-menu"
      :style="{ left: tagMenuPos.x + 'px', top: tagMenuPos.y + 'px' }"
      @click.stop
    >
      <li @click="ctxAddChild"><el-icon><Plus /></el-icon>添加子分类</li>
      <li @click="ctxMove"><el-icon><Rank /></el-icon>移动层级</li>
      <li @click="ctxRename"><el-icon><EditPen /></el-icon>重命名</li>
      <li class="danger" @click="ctxDelete"><el-icon><Delete /></el-icon>删除</li>
    </ul>

    <!-- 标签选择弹窗（给文件勾选分类） -->
    <el-dialog v-model="pickTagVisible" title="选择分类" width="420px">
      <el-checkbox-group v-model="pickedTagNames">
        <el-checkbox v-for="t in tags" :key="t.id" :label="t.name">
          <el-icon :color="t.color"><PriceTag /></el-icon>
          {{ t.name }}
        </el-checkbox>
      </el-checkbox-group>
      <el-divider />
      <div class="quick-create">
        <el-input v-model="quickTagName" placeholder="或输入新分类名" size="small" />
        <el-button size="small" @click="quickCreate">新建并勾选</el-button>
      </div>
      <template #footer>
        <el-button @click="pickTagVisible = false">取消</el-button>
        <el-button type="primary" @click="savePickedTags">保存</el-button>
      </template>
    </el-dialog>

    <!-- 扫描文件夹压缩包弹窗 -->
    <el-dialog v-model="scanDialogVisible" title="扫描到的压缩包" width="740px">
      <el-alert
        type="success"
        :closable="false"
        show-icon
        :title="`共识别到 ${scannedArchives.length} 个压缩包，已默认全选，可在列表中勾选/取消`"
        style="margin-bottom: 12px"
      />

      <el-table
        ref="scanTableRef"
        :data="scannedArchives"
        height="300"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column label="压缩包名" min-width="200" show-overflow-tooltip prop="name" />
        <el-table-column label="所在相对路径" min-width="220" show-overflow-tooltip prop="relPath" />
        <el-table-column label="大小" width="110">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
      </el-table>

      <div class="batch-meta">
        已选 <b>{{ selectedRows.length }}</b> 个，共 <b>{{ formatSize(scanTotalSize) }}</b>
      </div>

      <el-form label-width="72px" style="margin-top: 4px">
        <subdir-picker ref="batchPickerRef" v-model="batchSubdir" />
      </el-form>

      <el-progress v-if="batchProgress" :percentage="batchProgress" :stroke-width="8" style="margin-top: 10px" />

      <template #footer>
        <el-button @click="scanDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="batchProgress > 0 && batchProgress < 100"
          @click="submitBatchUpload"
        >
          开始批量上传 ({{ selectedRows.length }})
        </el-button>
      </template>
    </el-dialog>

    <!-- 批量添加标签弹窗 -->
    <el-dialog v-model="batchTagsVisible" title="批量设置标签" width="480px">
      <el-alert
        type="info" :closable="false" show-icon
        :title="`将对选中的 ${selectedFiles.length} 个文件操作`"
        style="margin-bottom: 12px"
      />

      <!-- 模式切换 -->
      <el-radio-group v-model="batchTagsMode" style="margin-bottom: 12px">
        <el-radio-button label="append">追加标签（保留原有）</el-radio-button>
        <el-radio-button label="replace">覆盖标签</el-radio-button>
      </el-radio-group>

      <p class="picker-label">选择标签（可多选）：</p>
      <el-checkbox-group v-model="batchTagNames" class="tag-checkbox-group">
        <el-checkbox v-for="t in tags" :key="t.id" :label="t.name">
          <el-icon :color="t.color"><PriceTag /></el-icon>
          {{ t.name }}
        </el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!tags.length" description="暂无标签，请先在下方新建" :image-size="50" />

      <el-divider />
      <div class="quick-create">
        <el-input v-model="batchNewTagName" placeholder="新标签名" size="small" />
        <el-color-picker v-model="batchNewTagColor" size="small" />
        <el-button size="small" type="primary" @click="batchQuickCreateTag">新建</el-button>
      </div>

      <template #footer>
        <el-button @click="batchTagsVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatchTags">应用</el-button>
      </template>
    </el-dialog>

    <!-- 分享弹窗 -->
    <el-dialog v-model="shareDialog" title="分享文件" width="460px">
      <el-form label-width="90px">
        <el-form-item label="提取密码">
          <el-input v-model="shareForm.password" placeholder="留空表示无密码" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="shareForm.expireDays">
            <el-option label="1 天" :value="1" />
            <el-option label="7 天" :value="7" />
            <el-option label="30 天" :value="30" />
            <el-option label="永久" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="权限">
          <el-radio-group v-model="shareForm.permission">
            <el-radio label="preview">仅预览</el-radio>
            <el-radio label="download">可下载</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <div v-if="shareLink" class="share-result">
        <img v-if="qrDataUrl" :src="qrDataUrl" class="qr-img" alt="二维码" />
        <el-input :model-value="shareLink" readonly size="small">
          <template #append><el-button @click="copyLink">复制</el-button></template>
        </el-input>
        <p class="lan-tip">📱 手机扫码或在手机浏览器打开此链接（手机需连接同一个 WiFi）</p>
      </div>
      <template #footer>
        <el-button @click="shareDialog = false">关闭</el-button>
        <el-button type="primary" @click="submitShare">生成链接</el-button>
      </template>
    </el-dialog>

    <!-- 压缩包立绘预览 -->
    <painting-dialog v-model="paintingDialogVisible" :file="paintingFile" />

    <!-- 动态立绘预览（Spine / Live2D）-->
    <dynamic-dialog v-model="dynamicDialogVisible" :file="dynamicFile" />

    <!-- Mod 一键注入游戏（zip/rar/7z）-->
    <mod-dialog v-model="modDialogVisible" :file="modFile" @changed="refresh" />

    <!-- 批量打包下载进度 -->
    <el-dialog v-model="batchDownloadVisible" title="打包下载" width="460px"
      :show-close="!batchDownloading" :close-on-click-modal="false" :close-on-press-escape="!batchDownloading">
      <div class="batch-download-box">
        <el-progress
          :percentage="batchDownloadPercent"
          :status="batchDownloadPercent >= 100 ? 'success' : ''"
          :stroke-width="16"
          text-inside
        />
        <p class="bd-line">{{ batchDownloadTip }}</p>
        <p class="bd-sub">正在把 {{ batchDownloadCount }} 个文件打包为 zip（仅打包不压缩），请保持窗口打开…</p>
      </div>
      <template #footer>
        <el-button :disabled="batchDownloading" @click="batchDownloadVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 批量注入进度 / 结果 -->
    <el-dialog
      v-model="batchInjectVisible"
      :show-close="!batchInjecting"
      :close-on-click-modal="false"
      :close-on-press-escape="!batchInjecting"
      title="批量注入"
      width="560px"
    >
      <div v-if="batchInjecting" class="batch-loading">
        <el-icon class="is-loading" :size="28"><Loading /></el-icon>
        <p>正在逐个注入，请勿关闭窗口或断开 MuMu…</p>
      </div>
      <template v-else-if="batchResult">
        <el-result
          :icon="batchResult.failed === 0 ? 'success' : 'warning'"
          :title="`成功 ${batchResult.success} 个，失败 ${batchResult.failed} 个`"
          sub-title="重启游戏生效；失败项可查看原因后单独重试"
        />
        <el-scrollbar max-height="260px">
          <el-table :data="batchResult.results" size="small" stripe max-height="260">
            <el-table-column prop="name" label="压缩包" min-width="180" show-overflow-tooltip />
            <el-table-column label="结果" width="90">
              <template #default="{ row }">
                <el-tag v-if="row.ok" type="success" size="small">成功</el-tag>
                <el-tag v-else type="danger" size="small">失败</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="详情" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.ok ? `${row.count} 个文件${row.source ? '（' + row.source + '）' : ''}` : row.error }}
              </template>
            </el-table-column>
          </el-table>
        </el-scrollbar>
      </template>
      <template #footer>
        <el-button :disabled="batchInjecting" @click="batchResult = null">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Upload, UploadFilled, Cpu, Loading, Document } from '@element-plus/icons-vue';
import SubdirPicker from '../components/SubdirPicker.vue';
import {
  browseFiles, uploadFile, batchUploadFiles, renameFile, starFile, setFileTags, deleteFile, batchDeleteFiles, batchApplyTags, downloadFile, batchDownloadFiles,
} from '../api/file.js';
import { isArchive, formatSize, sortFileList } from '../utils/format.js';
import { getTagTree as fetchTagTreeApi, createTag, updateTag, deleteTag, setTagParent } from '../api/tag.js';
import TagTreeNode from '../components/TagTreeNode.vue';
import { searchFiles } from '../api/search.js';
import { createShare } from '../api/share.js';
import { getLanIp } from '../api/public.js';
import QRCode from 'qrcode';
import FileTable from '../components/FileTable.vue';
import ModDialog from '../components/ModDialog.vue';
import PaintingDialog from '../components/PaintingDialog.vue';
import DynamicDialog from '../components/DynamicDialog.vue';
import { batchApplyMod } from '../api/mod.js';

const route = useRoute();
const router = useRouter();

/* ---------- 状态 ---------- */
const tagTree = ref([]);
// 扁平化标签（含父链），供按名查找、批量标签等复用
const tags = computed(() => {
  const out = [];
  const walk = (nodes, parent = null) => {
    for (const n of nodes) {
      out.push({ ...n, parent_id: parent?.id ?? null });
      if (n.children?.length) walk(n.children, n);
    }
  };
  walk(tagTree.value);
  return out;
});
const currentTag = ref('');
const files = ref([]);
const typeFilter = ref('');
const uploadProgress = ref(0);

/* 排序：字段 + 独立方向 */
const sortField = ref('date');
const sortOrder = ref('desc');

/* 批量删除 */
const mainTableRef = ref();
const selectedFiles = ref([]);

/* 扫描文件夹压缩包 & 批量上传 */
const scanDialogVisible = ref(false);
const scannedArchives = ref([]); // { name, relPath, size, file }
const selectedRows = ref([]);
const scanTableRef = ref();
const batchTag = ref('');
const batchSubdir = ref('');
const batchPickerRef = ref(null);
const batchProgress = ref(0);

const searchMode = ref(false);
const searchKeyword = ref('');
const searchResults = ref([]);

const currentTagColor = computed(
  () => tags.value.find((t) => t.name === currentTag.value)?.color || '#409eff'
);
// 顶级标签聚合数之和（避免嵌套重复计数）
const totalCount = computed(() =>
  files.value.length || tagTree.value.reduce((s, t) => s + (t.fileCount || 0), 0)
);
const filteredFiles = computed(() =>
  typeFilter.value ? files.value.filter((f) => f.type === typeFilter.value) : files.value
);

// 最终展示：先筛选再排序
const sortedFiles = computed(() => sortFileList(filteredFiles.value, sortField.value, sortOrder.value));
const sortedSearchResults = computed(() =>
  sortFileList(searchResults.value, sortField.value, sortOrder.value)
);

// 独立反转排序方向
function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
}

/* ---------- 批量删除 ---------- */

function onFileSelectionChange(rows) {
  selectedFiles.value = rows;
}

/* ---------- 批量打包下载 ---------- */
const batchDownloading = ref(false);
const batchDownloadVisible = ref(false);
const batchDownloadPercent = ref(0);
const batchDownloadTip = ref('准备中…');
const batchDownloadCount = ref(0);

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function submitBatchDownload() {
  if (!selectedFiles.value.length) return;
  const ids = selectedFiles.value.map(f => f.id);

  // 仅选中 1 个：直接下载原文件（保持原文件名，不再另行打包压缩）
  if (ids.length === 1) {
    const only = selectedFiles.value[0];
    try {
      await downloadFile(only.id, only.name);
      ElMessage.success(`已下载：${only.name}`);
    } catch (e) {
      ElMessage.error(e?.message || '下载失败');
    }
    return;
  }

  const totalSize = selectedFiles.value.reduce((s, f) => s + (Number(f.size) || 0), 0);
  const GB = 1024 ** 3;
  // 大体积/大数量先二次确认，避免误操作长时间占用
  if (totalSize > 2 * GB || ids.length > 200) {
    try {
      await ElMessageBox.confirm(
        `本次共 ${ids.length} 个文件、约 ${formatBytes(totalSize)}，打包下载可能需要较长时间，确认继续？`,
        '打包下载确认',
        { type: 'warning', confirmButtonText: '继续下载', cancelButtonText: '取消' }
      );
    } catch {
      return;
    }
  }
  batchDownloading.value = true;
  batchDownloadVisible.value = true;
  batchDownloadPercent.value = 0;
  batchDownloadCount.value = ids.length;
  batchDownloadTip.value = '正在打包并下载…';
  try {
    const result = await batchDownloadFiles(ids, totalSize, (loaded, total, percent) => {
      batchDownloadPercent.value = percent ?? Math.min(99, Math.round((loaded / Math.max(total, 1)) * 100));
      batchDownloadTip.value = `已下载 ${formatBytes(loaded)}${total ? ' / ' + formatBytes(total) : ''}`;
    });
    batchDownloadPercent.value = 100;
    batchDownloadTip.value = `已保存：${result.filename}`;
    ElMessage.success(`已打包下载 ${ids.length} 个文件`);
  } catch (e) {
    batchDownloadVisible.value = false;
    ElMessage.error(e.message || '打包下载失败');
  } finally {
    batchDownloading.value = false;
  }
}

/* ---------- 批量注入 mod ---------- */

// 勾选里的压缩包数量（只有压缩包可注入）
const selectedArchives = computed(() => selectedFiles.value.filter(f => isArchive(f.name)));
const selectedArchiveCount = computed(() => selectedArchives.value.length);
const batchInjecting = ref(false);
const batchResult = ref(null); // { total, success, failed, results }
const batchInjectVisible = computed(() => batchInjecting.value || !!batchResult.value);

async function submitBatchInject() {
  const archives = selectedArchives.value;
  if (!archives.length) return ElMessage.warning('请先勾选要注入的压缩包（zip/rar/7z）');
  try {
    await ElMessageBox.confirm(
      `将把选中的 ${archives.length} 个压缩包逐个注入 MuMu 中的碧蓝航线，重启游戏生效。\n含多个版本的包将默认使用第一个版本。请确认 MuMu 已启动并连接。`,
      '批量注入确认',
      { type: 'warning', confirmButtonText: '开始注入' }
    );
  } catch {
    return;
  }
  batchInjecting.value = true;
  batchResult.value = null;
  try {
    const r = await batchApplyMod(archives.map(f => f.id));
    batchResult.value = r;
    if (r.failed === 0) ElMessage.success(`全部 ${r.success} 个注入成功，重启游戏生效`);
    else ElMessage.warning(`成功 ${r.success} 个，失败 ${r.failed} 个`);
    mainTableRef.value?.clearSelection();
    await refresh();
  } catch (e) {
    // 通用错误拦截器已提示
  } finally {
    batchInjecting.value = false;
  }
}

async function submitBatchDelete() {
  const n = selectedFiles.value.length;
  if (!n) return ElMessage.warning('请先勾选要删除的文件');
  await ElMessageBox.confirm(
    `确定将选中的 ${n} 个文件放入回收站吗？可在回收站还原。`,
    '批量删除确认',
    { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
  );
  const res = await batchDeleteFiles(selectedFiles.value.map((f) => f.id));
  ElMessage.success(res.message || `已删除 ${res.successCount} 个文件`);
  mainTableRef.value?.clearSelection();
  await refresh();
}

/* ---------- 批量标签 ---------- */

const batchTagsVisible = ref(false);
const batchTagsMode = ref('append'); // append | replace
const batchTagNames = ref([]);
const batchNewTagName = ref('');
const batchNewTagColor = ref('#409eff');

function openBatchTags() {
  if (!selectedFiles.value.length) return ElMessage.warning('请先勾选文件');
  batchTagsMode.value = 'append';
  batchTagNames.value = [];
  batchNewTagName.value = '';
  batchNewTagColor.value = '#409eff';
  batchTagsVisible.value = true;
}

async function batchQuickCreateTag() {
  const name = batchNewTagName.value.trim();
  if (!name) return ElMessage.warning('请输入标签名');
  await createTag({ name, color: batchNewTagColor.value });
  await loadTags();
  if (!batchTagNames.value.includes(name)) batchTagNames.value.push(name);
  batchNewTagName.value = '';
  ElMessage.success('已新建并勾选');
}

async function submitBatchTags() {
  if (!batchTagNames.value.length) return ElMessage.warning('请至少选择一个标签');
  const selected = tags.value.filter((t) => batchTagNames.value.includes(t.name));
  const ids = selectedFiles.value.map((f) => f.id);
  const res = await batchApplyTags(
    ids,
    selected.map((t) => ({ name: t.name, color: t.color })),
    batchTagsMode.value
  );
  ElMessage.success(res.message || '标签已应用');
  batchTagsVisible.value = false;
  mainTableRef.value?.clearSelection();
  await refresh();
}

/* ---------- 加载 ---------- */

// 通过树查某标签父 id（顶级返回 null）
function tagDndParentOf(id) {
  let pid = null;
  const walk = (nodes, parent) => {
    for (const n of nodes) {
      if (n.id === id) { pid = parent ? parent.id : null; return true; }
      if (n.children?.length && walk(n.children, n)) return true;
    }
    return false;
  };
  walk(tagTree.value, null);
  return pid;
}

// 拖拽排序依赖：提供给递归节点组件
provide('tagDndDeps', {
  tree: tagTree,
  parentOf: tagDndParentOf,
  // 重排后：成功时树已原地修改，无需重拉；失败时 force=true 重新拉取还原
  onReordered(force = false) {
    if (force) loadTags();
  },
});

async function loadTags() {
  tagTree.value = await fetchTagTreeApi();
}

async function loadFiles() {
  files.value = await browseFiles({ tag: currentTag.value });
}

async function selectTag(name) {
  currentTag.value = name;
  typeFilter.value = '';
  mainTableRef.value?.clearSelection();
  selectedFiles.value = [];
  await loadFiles();
}

/* ---------- 上传 ---------- */

function triggerUpload() {
  document.querySelector('.upload-zone input')?.click();
}

/* 上传目标目录选择 */
const uploadTargetVisible = ref(false);
const uploading = ref(false);
const uploadSubdir = ref('');
const uploadPickerRef = ref(null);
const pendingFiles = ref([]);

// el-upload 多选时会逐个触发 change；这里收集本轮选择，统一弹窗
function onPickFile(uploadItem) {
  if (uploadItem?.raw) {
    pendingFiles.value.push(uploadItem.raw);
  }
  // 等本轮 change 都触发后再打开弹窗
  clearTimeout(onPickFile._t);
  onPickFile._t = setTimeout(openUploadTarget, 80);
}

function openUploadTarget() {
  if (!pendingFiles.value.length) return;
  // 默认目标：当前所在标签页目录
  uploadSubdir.value = currentTag.value || '';
  uploadTargetVisible.value = true;
  uploadProgress.value = 0;
}

function cancelUploadTarget() {
  if (uploading.value) return;
  uploadTargetVisible.value = false;
  pendingFiles.value = [];
  uploadProgress.value = 0;
}

async function confirmUploadTarget() {
  if (uploading.value || !pendingFiles.value.length) return;
  const target = uploadPickerRef.value?.value || { rootId: null, subdir: uploadSubdir.value };
  uploading.value = true;
  uploadProgress.value = 0;
  let ok = 0;
  try {
    if (pendingFiles.value.length === 1) {
      await uploadFile(
        pendingFiles.value[0], currentTag.value,
        (p) => { uploadProgress.value = p; },
        { subdir: target.subdir, rootId: target.rootId }
      );
      ok = 1;
    } else {
      // 多文件：逐个上传（复用进度），统一进所选目录
      for (let i = 0; i < pendingFiles.value.length; i += 1) {
        await uploadFile(
          pendingFiles.value[i], currentTag.value,
          () => { uploadProgress.value = Math.round(((i + 1) / pendingFiles.value.length) * 100); },
          { subdir: target.subdir, rootId: target.rootId }
        );
        ok += 1;
      }
    }
    ElMessage.success(`成功上传 ${ok} 个文件`);
    uploadTargetVisible.value = false;
    pendingFiles.value = [];
    await refresh();
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
  }
}

async function refresh() {
  await loadTags();
  await loadFiles();
}

/* ---------- 扫描文件夹内压缩包 ---------- */

function triggerScanFolder() {
  document.getElementById('folder-picker')?.click();
}

function onFolderPicked(event) {
  const input = event.target;
  const all = Array.from(input.files || []);
  const archives = all
    .filter((f) => isArchive(f.name))
    .map((f) => ({
      name: f.name,
      relPath: f.webkitRelativePath || f.name,
      size: f.size,
      file: f,
    }));

  if (!archives.length) {
    ElMessage.info('该文件夹（含子文件夹）内未找到压缩包');
  } else {
    scannedArchives.value = archives;
    selectedRows.value = archives;
    batchTag.value = currentTag.value;
    batchSubdir.value = currentTag.value || '';
    batchProgress.value = 0;
    scanDialogVisible.value = true;
    // 默认全部勾选
    nextTick(() => scanTableRef.value?.toggleAllSelection());
  }
  input.value = ''; // 允许再次选择同一文件夹
}

function onSelectionChange(rows) {
  selectedRows.value = rows;
}

const scanTotalSize = computed(() =>
  selectedRows.value.reduce((s, r) => s + r.size, 0)
);

async function quickCreateTagForBatch() {
  const { value } = await ElMessageBox.prompt('新分类名称', '新建分类', {
    inputValidator: (v) => !!v?.trim() || '名称不能为空',
  });
  await createTag({ name: value.trim(), color: '#409eff' });
  await loadTags();
  batchTag.value = value.trim();
  ElMessage.success('已创建并选中');
}

async function submitBatchUpload() {
  if (!selectedRows.value.length) return ElMessage.warning('请至少选择一个压缩包');
  const target = batchPickerRef.value?.value || { rootId: null, subdir: batchSubdir.value };
  batchProgress.value = 0;
  try {
    const res = await batchUploadFiles(
      selectedRows.value.map((r) => r.file),
      batchTag.value,
      (p) => {
        batchProgress.value = p;
      },
      { subdir: target.subdir, rootId: target.rootId }
    );
    ElMessage.success(res.message || `成功上传 ${res.successCount} 个压缩包`);
    scanDialogVisible.value = false;
    await refresh();
  } finally {
    batchProgress.value = 0;
  }
}

/* ---------- 标签分类的增改删 / 右键菜单 ---------- */

const tagDialogVisible = ref(false);
const editingTag = reactive({ id: null, name: '', color: '#409eff', parentId: null, parentName: '' });

const tagDialogTitle = computed(() => {
  if (editingTag.id) return '重命名分类';
  return editingTag.parentName ? `在「${editingTag.parentName}」下添加子分类` : '新建顶级分类';
});

function tagStyle(tag) {
  const c = tag?.color || '#409eff';
  return { background: c + '22', borderColor: c, color: c };
}

// 顶级新建（左侧分类区 + 按钮）
function openCreateTag() {
  editingTag.id = null;
  editingTag.name = '';
  editingTag.color = '#409eff';
  editingTag.parentId = null;
  editingTag.parentName = '';
  tagDialogVisible.value = true;
}

/* ---- 右键浮层菜单 ---- */
const tagMenuVisible = ref(false);
const tagMenuPos = reactive({ x: 0, y: 0 });
const menuTag = ref(null);

function tagMenu(event, tag) {
  menuTag.value = tag;
  tagMenuPos.x = Math.min(event.clientX, window.innerWidth - 180);
  tagMenuPos.y = Math.min(event.clientY, window.innerHeight - 200);
  tagMenuVisible.value = true;
  setTimeout(() => document.addEventListener('click', closeTagMenu, { once: true }), 0);
}
function closeTagMenu() {
  tagMenuVisible.value = false;
  menuTag.value = null;
}

function ctxAddChild() {
  const t = menuTag.value;
  closeTagMenu();
  editingTag.id = null;
  editingTag.name = '';
  editingTag.color = t?.color || '#409eff';
  editingTag.parentId = t?.id ?? null;
  editingTag.parentName = t?.name || '';
  tagDialogVisible.value = true;
}

function ctxRename() {
  const t = menuTag.value;
  closeTagMenu();
  editingTag.id = t.id;
  editingTag.name = t.name;
  editingTag.color = t.color;
  editingTag.parentId = null;
  editingTag.parentName = '';
  tagDialogVisible.value = true;
}

async function ctxDelete() {
  const t = menuTag.value;
  closeTagMenu();
  const childN = t.children?.length || 0;
  try {
    await ElMessageBox.confirm(
      `确定删除分类「${t.name}」？该分类下文件不会被删除。` + (childN ? ` 其 ${childN} 个子分类将上移一级。` : ''),
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  await deleteTag(t.id);
  ElMessage.success('分类已删除');
  if (currentTag.value === t.name) currentTag.value = '';
  await refresh();
}

/* ---- 移动层级 ---- */
const moveDialogVisible = ref(false);
const moveTag = ref(null);
const moveTargetId = ref(0);

const moveTreeData = computed(() => {
  if (!moveTag.value) return [];
  const blocked = new Set([moveTag.value.id]);
  const blockDesc = (n) => (n.children || []).forEach((c) => { blocked.add(c.id); blockDesc(c); });
  blockDesc(moveTag.value);
  const collect = (nodes) => nodes
    .filter((n) => !blocked.has(n.id))
    .map((n) => ({
      id: n.id,
      name: n.name,
      children: n.children?.length ? collect(n.children) : undefined,
    }));
  return collect(tagTree.value);
});

function ctxMove() {
  const t = menuTag.value;
  closeTagMenu();
  moveTag.value = t;
  moveTargetId.value = tagDndParentOf(t.id) ?? 0;
  moveDialogVisible.value = true;
}

async function submitMove() {
  try {
    await setTagParent(moveTag.value.id, moveTargetId.value || 0);
    ElMessage.success('层级已更新');
    moveDialogVisible.value = false;
    await refresh();
  } catch (e) {
    ElMessage.error(e?.message || '移动失败');
  }
}

async function submitTag() {
  const name = editingTag.name.trim();
  if (!name) return ElMessage.warning('请输入名称');
  if (editingTag.id) {
    await updateTag(editingTag.id, { name, color: editingTag.color });
    ElMessage.success('已更新');
  } else {
    await createTag({
      name,
      color: editingTag.color,
      parentId: editingTag.parentId ?? undefined,
    });
    ElMessage.success('分类创建成功');
  }
  tagDialogVisible.value = false;
  await refresh();
}

/* ---------- 文件操作 ---------- */

const editingFileId = ref(null);

async function onFileAction({ action, row }) {
  switch (action) {
    case 'download':
      await downloadFile(row.id, row.name);
      break;
    case 'rename': {
      const { value } = await ElMessageBox.prompt('新文件名', '重命名', { inputValue: row.name });
      await renameFile(row.id, value);
      ElMessage.success('重命名成功');
      await refresh();
      break;
    }
    case 'star':
      await starFile(row.id, !row.is_starred);
      ElMessage.success(row.is_starred ? '已取消收藏' : '已收藏');
      await refresh();
      break;
    case 'tags':
      editingFileId.value = row.id;
      pickedTagNames.value = (row.tags || []).map((t) => t.name);
      quickTagName.value = '';
      pickTagVisible.value = true;
      break;
    case 'delete':
      await ElMessageBox.confirm(`确定删除“${row.name}”？将进入回收站`, '确认', { type: 'warning' });
      await deleteFile(row.id);
      ElMessage.success('已放入回收站');
      await refresh();
      break;
    case 'share':
      await openShare(row);
      break;
    case 'mod':
      modFile.value = row;
      modDialogVisible.value = true;
      break;
    case 'painting':
      paintingFile.value = row;
      paintingDialogVisible.value = true;
      break;
    case 'dynamic':
      dynamicFile.value = row;
      dynamicDialogVisible.value = true;
      break;
  }
}

/* ---------- Mod 注入 ---------- */
const modDialogVisible = ref(false);
const modFile = ref(null);

/* ---------- 立绘预览 ---------- */
const paintingDialogVisible = ref(false);
const paintingFile = ref(null);

/* ---------- 动态立绘预览 ---------- */
const dynamicDialogVisible = ref(false);
const dynamicFile = ref(null);

/* ---------- 勾选标签弹窗 ---------- */

const pickTagVisible = ref(false);
const pickedTagNames = ref([]);
const quickTagName = ref('');

async function quickCreate() {
  const name = quickTagName.value.trim();
  if (!name) return ElMessage.warning('请输入分类名');
  await createTag({ name, color: '#409eff' });
  await loadTags();
  if (!pickedTagNames.value.includes(name)) pickedTagNames.value.push(name);
  quickTagName.value = '';
  ElMessage.success('已新建并勾选');
}

async function savePickedTags() {
  const selected = tags.value.filter((t) => pickedTagNames.value.includes(t.name));
  await setFileTags(
    editingFileId.value,
    selected.map((t) => ({ name: t.name, color: t.color }))
  );
  ElMessage.success('分类已更新');
  pickTagVisible.value = false;
  await refresh();
}

/* ---------- 分享 ---------- */

const shareDialog = ref(false);
const shareForm = reactive({ password: '', expireDays: 7, permission: 'download' });
const shareLink = ref('');
const qrDataUrl = ref('');
const lanIp = ref('');

async function openShare(row) {
  editingFileId.value = row.id;
  shareForm.password = '';
  shareForm.expireDays = 7;
  shareForm.permission = 'download';
  shareLink.value = '';
  qrDataUrl.value = '';
  shareDialog.value = true;
  try {
    const info = await getLanIp();
    lanIp.value = info.preferred || '';
  } catch {
    lanIp.value = '';
  }
}

async function submitShare() {
  const res = await createShare({ fileId: editingFileId.value, ...shareForm });
  const host = lanIp.value ? `http://${lanIp.value}:5173` : window.location.origin;
  shareLink.value = `${host}/share/${res.code}`;
  qrDataUrl.value = await QRCode.toDataURL(shareLink.value, { width: 200, margin: 1 });
}

function copyLink() {
  navigator.clipboard.writeText(shareLink.value);
  ElMessage.success('链接已复制');
}

/* ---------- 全局搜索 ---------- */

async function runGlobalSearch(q) {
  searchMode.value = true;
  searchKeyword.value = q;
  searchResults.value = await searchFiles({ q });
}

function exitSearch() {
  searchMode.value = false;
  searchKeyword.value = '';
  searchResults.value = [];
  router.replace({ query: {} });
}

watch(
  () => route.query.q,
  (q) => {
    if (q) runGlobalSearch(q);
  }
);

onMounted(async () => {
  await loadTags();
  if (route.query.q) await runGlobalSearch(route.query.q);
  // 从“标签管理”页点文件数跳转：?tag=名称 自动进入该分类筛选（复用 selectTag）
  else if (route.query.tag) await selectTag(String(route.query.tag));
  else await loadFiles();
});
</script>

<style scoped>
.files-page,
.full {
  height: 100%;
}
/* 分类列固定 190px（与左侧导航一致），右侧自适应占满；强制不换行，
   防止右侧表格偏宽时把内容列挤到分类框下方。
   高度由内容撑开（不用 height:100%），否则 sticky 只在一屏内生效 */
.tag-layout {
  flex-wrap: nowrap;
  height: auto;
  min-height: 100%;
}
.tag-layout .tag-col {
  flex: 0 0 190px;
  max-width: 190px;
  /* 右侧滚动时分类栏固定在顶部，方便随时切换标签 */
  align-self: flex-start;
  position: sticky;
  top: 16px;
}
.tag-layout .content-col {
  flex: 1 1 0%;
  max-width: 100%;
  min-width: 0;
}
.batch-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 0;
  color: #909399;
}
.side-card :deep(.el-card__body) {
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  padding: 10px;
}
.side-card :deep(.el-card__header) {
  padding: 10px 12px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}
.tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.tag-item:hover {
  background: #f0f5ff;
}
.tag-item.active {
  background: #e6f0ff;
}
.tag-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.view-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 16px;
}
.toolbar {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
/* 类型筛选 + 排序：强制独占一行，靠右排列 */
.filter-bar {
  flex: 0 0 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.sort-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sort-label {
  font-size: 14px;
  color: #606266;
}
.upload-zone {
  width: 100%;
  margin-bottom: 12px;
}
.upload-zone :deep(.el-upload-dragger) {
  padding: 20px;
}
.quick-create {
  display: flex;
  gap: 8px;
}
.share-result {
  text-align: center;
}
.qr-img {
  width: 180px;
  height: 180px;
  margin-bottom: 10px;
}
.lan-tip {
  color: #909399;
  font-size: 12px;
  margin: 8px 0 0;
}
.hidden-folder-input {
  display: none;
}
.batch-meta {
  margin-top: 10px;
  font-size: 14px;
  color: #606266;
}
.batch-tag-bar {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.picker-label {
  margin: 0 0 8px;
  font-size: 14px;
  color: #606266;
}
.tag-checkbox-group {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px;
}
/* 标签右键浮层菜单 */
.tag-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 148px;
  margin: 0;
  padding: 6px 0;
  list-style: none;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  border: 1px solid #ebeef5;
}
.tag-context-menu li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
}
.tag-context-menu li:hover {
  background: #f0f5ff;
  color: #1d6fe0;
}
.tag-context-menu li.danger {
  color: #f56c6c;
}
.tag-context-menu li.danger:hover {
  background: #fef0f0;
  color: #f56c6c;
}
</style>
