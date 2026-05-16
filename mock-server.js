const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// 持久化文件：重启 mock 服务后流程数据不丢失
const DATA_FILE = path.join(__dirname, "mock-data.json");

const defaultFlows = () => ({
  "demo-flow-001": {
    nodes: [],
    edges: [],
  },
});

let flows = defaultFlows();

// --reset 参数用于 E2E/CI 场景：启动时丢弃历史数据，保证测试环境干净
if (process.argv.includes("--reset")) {
  try {
    fs.unlinkSync(DATA_FILE);
  } catch (error) {
    // 文件不存在时忽略
  }
} else {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      flows = parsed;
    }
  } catch (error) {
    // 没有历史文件或内容损坏时使用默认数据
  }
}

const persist = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(flows, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to persist mock data:", error.message);
  }
};

// 根路由作为健康检查：Playwright webServer 的就绪探测要求返回 200~403
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (username && password) {
    res.json({
      accessToken: `mock_access_${Date.now()}`,
      refreshToken: `mock_refresh_${Date.now()}`,
    });
    return;
  }

  res.status(401).json({ message: "Invalid credentials" });
});

app.post("/api/auth/refresh", (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken && refreshToken.startsWith("mock_refresh")) {
    res.json({ accessToken: `new_access_${Date.now()}` });
    return;
  }

  res.status(401).json({ message: "Invalid refresh token" });
});

app.get("/api/flows/:id", (req, res) => {
  const flow = flows[req.params.id];
  if (!flow) {
    res.status(404).json({ message: "Flow not found" });
    return;
  }

  res.json(flow);
});

app.post("/api/flows/:id", (req, res) => {
  flows[req.params.id] = req.body;
  persist();
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log("Mock server running on http://localhost:3000");
});
