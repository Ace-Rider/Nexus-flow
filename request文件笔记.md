# request.ts 学习笔记

这个文件的核心作用是：统一处理请求、自动带上 token、在 401 时自动刷新 token，并把失败的请求重新发出去。

## 它解决了什么问题

- `accessToken` 过期后，接口会返回 `401`
- 如果不处理，用户会频繁掉回登录页
- 这个文件的目标是让前端自动续期，尽量让用户无感知

## 主要流程

```text
普通请求 -> 返回 401 -> 进入响应拦截器
            -> 判断是否可补救
            -> 如果没人刷新 token，就由当前请求发起刷新
            -> 如果已有请求在刷新，就先排队等待
            -> 刷新成功：统一放行队列，并重发原请求
            -> 刷新失败：清空 token，跳转登录页
```

## 关键变量

- `request`
  - axios 实例
  - 所有请求都通过它发出

- `isRefreshing`
  - 是否正在刷新 token
  - 用来防止多个请求同时刷新

- `failedQueue`
  - 等待中的请求队列
  - 存的是每个 Promise 的 `resolve` 和 `reject`

- `originalRequest`
  - 当前失败的原始请求配置
  - 用来在刷新成功后重新发送

- `_retry`
  - 自定义标记
  - 表示这个请求是否已经重试过

- `isRefreshRequest`
  - 判断当前失败请求是不是 `/auth/refresh`
  - 防止刷新接口自己再次触发刷新逻辑

- `authStore`
  - Pinia 认证仓库
  - 提供 token、刷新 token、清空 token 的能力

## 为什么要创建 Promise

当已有请求在刷新 token 时，后来的 401 请求不能自己再刷新，只能先挂起等待。

```ts
return new Promise<string>((resolve, reject) => {
  failedQueue.push({ resolve, reject });
})
```

这里创建的 Promise 代表：

- 我先等刷新结果
- 刷新成功我就继续
- 刷新失败我就失败

## 为什么要把 resolve 和 reject 存进数组

- `resolve` 是让这个 Promise 成功的按钮
- `reject` 是让这个 Promise 失败的按钮
- `failedQueue` 负责把这些“等待中的按钮”先存起来
- 等刷新结果出来后，再统一处理所有排队请求

## 为什么要判断 `isRefreshRequest`

如果刷新 token 的请求本身也返回 `401`，就说明自动续期这条路已经失败了。

如果不拦住它，就可能出现：

- 普通请求 401
- 调 `/auth/refresh`
- `/auth/refresh` 也 401
- 又去调 `/auth/refresh`
- 无限循环

所以这里要直接放弃继续刷新，转去清空登录状态。

## 为什么要判断 `_retry`

- 防止一个请求反复重试
- 避免“401 -> 刷新 -> 重发 -> 再 401 -> 再刷新”的死循环

## 你可以这样记

- `isRefreshing`：当前有没有人正在补 token
- `failedQueue`：其他人先排队等结果
- `processQueue`：统一发放结果
- `originalRequest`：失败了就拿它重发
- `isRefreshRequest`：刷新接口自己失败就别再救了
- `_retry`：这个请求别无限重试

## 一句话总结

这个拦截器的目标不是“让所有错误消失”，而是：

- 能补救的 401 自动补救
- 不能补救的就回登录页
- 尽量减少用户感知
