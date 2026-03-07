<template>
  <div class="login-page">
    <section class="login-hero">
      <div class="login-hero__badge">Workflow Studio</div>
      <h1>Nexus Flow</h1>
      <p>面向流程设计、布局优化和版本管理的可视化工作台。</p>

      <div class="login-hero__rail">
        <span>绘制</span>
        <span>校验</span>
        <span>版本</span>
        <span>导出</span>
      </div>
    </section>

    <el-card class="login-card">
      <div class="login-card__header">
        <h2>登录进入设计器</h2>
        <p>输入任意非空账号即可体验演示模式。</p>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="login-form">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" size="large" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
            size="large"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleLogin" :loading="loading" class="login-submit">
            登录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-card__tip">
        演示模式下，输入任意非空用户名和密码即可登录。
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const authStore = useAuthStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: 'demo',
  password: '123456',
});

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

const handleLogin = async () => {
  if (!formRef.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    const success = await authStore.login(form.username, form.password);
    if (success) {
      ElMessage.success('登录成功');
      router.push('/');
    } else {
      ElMessage.error('登录失败');
    }
  } catch (error) {
    ElMessage.error('网络错误');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-page {
  position: relative;
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 420px);
  gap: 36px;
  align-items: center;
  padding: 48px;
  overflow: hidden;
}

.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  inset: auto;
  border-radius: 999px;
  filter: blur(10px);
  pointer-events: none;
}

.login-page::before {
  width: 380px;
  height: 380px;
  left: -100px;
  top: -90px;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.16), transparent 68%);
}

.login-page::after {
  width: 420px;
  height: 420px;
  right: -140px;
  bottom: -140px;
  background: radial-gradient(circle, rgba(15, 118, 110, 0.14), transparent 68%);
}

.login-hero {
  position: relative;
  z-index: 1;
  max-width: 760px;
  padding: 24px 18px 24px 6px;
}

.login-hero__badge {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: rgba(255, 255, 255, 0.72);
  color: #2563eb;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 18px;
}

.login-hero h1 {
  font-size: clamp(52px, 8vw, 86px);
  line-height: 0.94;
  letter-spacing: -0.05em;
  margin: 0;
  color: #0f172a;
  font-family: Georgia, "Times New Roman", serif;
}

.login-hero p {
  max-width: 620px;
  margin: 18px 0 0;
  color: #5f6c82;
  font-size: 18px;
  line-height: 1.8;
}

.login-hero__rail {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
}

.login-hero__rail span {
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.74);
  color: #102033;
  font-size: 13px;
  box-shadow: var(--app-shadow);
}

.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px);
  box-shadow: var(--app-shadow);
}

.login-card :deep(.el-card__body) {
  padding: 32px;
}

.login-card__header h2 {
  margin: 0;
  font-size: 26px;
  color: #0f172a;
}

.login-card__header p {
  margin: 10px 0 0;
  color: var(--app-text-soft);
  line-height: 1.7;
}

.login-form {
  margin-top: 24px;
}

.login-form :deep(.el-form-item__label) {
  color: #102033;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 14px;
  background: rgba(244, 247, 251, 0.92);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.login-form :deep(.el-input__inner) {
  color: #102033;
}

.login-submit {
  width: 100%;
  height: 46px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #2563eb 0%, #0f766e 100%);
  box-shadow: 0 16px 34px rgba(37, 99, 235, 0.18);
}

.login-card__tip {
  margin-top: 16px;
  color: var(--app-text-soft);
  text-align: center;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .login-page {
    grid-template-columns: 1fr;
    padding: 24px;
  }

  .login-hero {
    padding: 12px 0 0;
  }
}

@media (max-width: 720px) {
  .login-page {
    padding: 16px;
    gap: 18px;
  }

  .login-hero h1 {
    font-size: 42px;
  }

  .login-hero p {
    font-size: 15px;
  }

  .login-card :deep(.el-card__body) {
    padding: 22px;
  }
}
</style>
