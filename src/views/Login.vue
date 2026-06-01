<!-- src/views/Login.vue -->
<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <h2>Nexus Flow 登录</h2>
      </template>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleLogin" :loading="loading" style="width: 100%">
            登录
          </el-button>
        </el-form-item>
      </el-form>
      <div class="mock-tip">
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
.login-container {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1bc791 0%, #37c34c 100%);
}

.login-card {
  width: 420px;
  border-radius: 12px;
  box-shadow: 0 20px 35px rgba(0, 0, 0, 0.2);
}

.mock-tip {
  font-size: 12px;
  color: #909399;
  text-align: center;
  margin-top: 16px;
}
</style>
