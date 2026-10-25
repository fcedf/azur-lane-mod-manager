<template>
  <div class="share-page">
    <div class="share-box">
      <div class="brand">
        <el-icon :size="28" color="#409eff"><FolderOpened /></el-icon>
        <span>文件分享</span>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="center">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <p>正在获取文件信息...</p>
      </div>

      <!-- 需要密码 -->
      <el-card v-else-if="needPassword" shadow="never" class="panel">
        <el-icon :size="40" color="#e6a23c"><Lock /></el-icon>
        <h3>该文件需要提取密码</h3>
        <el-input
          v-model="password"
          placeholder="请输入提取密码"
          show-password
          size="large"
          @keyup.enter="fetchInfo"
        />
        <el-button type="primary" size="large" style="margin-top: 14px; width: 100%" @click="fetchInfo">
          提取文件
        </el-button>
      </el-card>

      <!-- 文件信息 -->
      <el-card v-else-if="file" shadow="never" class="panel">
        <div class="file-info">
          <el-icon :size="44" color="#409eff"><Document /></el-icon>
          <div class="meta">
            <div class="fname" :title="file.name">{{ file.name }}</div>
            <div class="fsize">大小：{{ formatSize(file.size) }}</div>
          </div>
        </div>
        <el-button
          type="primary"
          size="large"
          style="margin-top: 18px; width: 100%"
          @click="doDownload"
        >
          <el-icon><Download /></el-icon>
          {{ permission === 'download' ? '下载文件' : '查看文件' }}
        </el-button>
        <p v-if="permission === 'preview'" class="hint">分享者设置为仅预览模式</p>
      </el-card>
    </div>

    <div class="footer">由「文件管理系统」提供分享服务</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getPublicShare, publicDownloadUrl } from '../api/public.js';
import { formatSize } from '../utils/format.js';

const route = useRoute();
const code = route.params.code;

const loading = ref(true);
const needPassword = ref(false);
const password = ref('');
const file = ref(null);
const permission = ref('download');

async function fetchInfo() {
  loading.value = true;
  try {
    const data = await getPublicShare(code, password.value);
    if (data.needPassword) {
      needPassword.value = true;
      if (password.value) ElMessage.error('提取密码不正确');
    } else {
      needPassword.value = false;
      file.value = data.file;
      permission.value = data.permission;
    }
  } finally {
    loading.value = false;
  }
}

function doDownload() {
  // 直接跳转下载（浏览器处理文件保存/打开）
  window.location.href = publicDownloadUrl(code, password.value);
}

onMounted(fetchInfo);
</script>

<style scoped>
.share-page {
  min-height: 100%;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.share-box {
  width: 100%;
  max-width: 420px;
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 20px;
}
.panel {
  border-radius: 12px;
  text-align: center;
  padding: 10px;
}
.panel h3 {
  margin: 14px 0;
  color: #333;
}
.center {
  text-align: center;
  color: #fff;
}
.file-info {
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
}
.meta {
  min-width: 0;
  flex: 1;
}
.fname {
  font-weight: 600;
  font-size: 15px;
  word-break: break-all;
}
.fsize {
  color: #909399;
  font-size: 13px;
  margin-top: 4px;
}
.hint {
  color: #909399;
  font-size: 12px;
  margin-top: 10px;
}
.footer {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  margin-top: 24px;
}
</style>
