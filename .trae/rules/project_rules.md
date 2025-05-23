# 项目规则

本文档概述了 "agent-jules" 项目的开发规则和约定。

## 1. 项目结构

本项目是一个 monorepo，包含以下主要部分：

- `backend/`: Python 后端应用程序 (FastAPI/Flask 或类似框架)。
  - `app/`: 核心应用代码。
  - `tests/`: 后端测试。
  - `tools/`: 后端可能使用的工具脚本。
  - `utils/`: 后端辅助函数。
- `frontend/`: TypeScript/React/Shade UI 前端应用程序 (使用 Vite 构建)。
  - `src/`: 前端源代码。
    - `components/`: 可复用 UI 组件。
    - `features/`: 特定功能的模块。
    - `pages/` 或 `routes/`: 页面级组件。
    - `lib/` 或 `utils/`: 前端辅助函数和工具。
    - `assets/`: 静态资源文件。
    - `routes/`: 路由配置，使用 `@tanstack/router`。
  - `public/`: 公共静态资源。
- `.trae/`: Trae AI 相关配置和规则。

## 2. 版本控制 (Git)

### 2.1 分支策略

- `main`: 生产环境分支，应始终保持稳定和可部署状态。
- `develop`: 主要开发分支，新功能和修复应合并到此分支。
- `feature/<feature-name>`: 用于开发新功能的分支，从 `develop` 分支创建。
- `bugfix/<issue-id>`: 用于修复 bug 的分支，从 `develop` 或 `main` (用于热修复) 分支创建。
- `hotfix/<issue-id>`: 用于紧急修复生产环境 bug 的分支，从 `main` 分支创建，修复后合并回 `main` 和 `develop`。

### 2.2 提交信息规范

建议遵循 Conventional Commits 规范 (https://www.conventionalcommits.org/)。

示例:
- `feat(frontend): add user login page`
- `fix(backend): resolve issue with order processing API`
- `docs: update backend API documentation`
- `style(frontend): format code with Prettier`
- `refactor(backend): improve database query performance`
- `test(frontend): add unit tests for payment component`
- `chore: update frontend dependencies`

## 3.编码规范

### 3.1 通用规范

- 使用 UTF-8 文件编码。
- 遵循 DRY (Don't Repeat Yourself) 原则。
- 编写清晰、可维护的代码，并添加必要的注释。

### 3.2 前端 (TypeScript/React)

- **代码风格**: 遵循项目根目录下的 `.prettierrc` 和 `eslint.config.js` 配置。
  - 在提交前运行 `pnpm format` 和 `pnpm lint`。
- **命名约定**:
  - 组件: PascalCase (e.g., `UserProfile.tsx`)
  - 函数/变量: camelCase (e.g., `getUserData`)
  - 常量: UPPER_SNAKE_CASE (e.g., `MAX_USERS`)
  - CSS 类名: kebab-case (e.g., `user-profile-card`)
- **组件结构**: 优先使用函数组件和 Hooks。
- **状态管理**: 根据项目复杂度选择合适的状态管理库 (如 Zustand, Redux Toolkit)，并在 `src/stores` 或 `src/context` 中组织。
- **路由**: 使用 TanStack Router (根据 `routeTree.gen.ts` 推断)，在 `src/routes/` 中定义路由。

### 3.3 后端 (Python)

- **代码风格**: 遵循 PEP 8 (https://www.python.org/dev/peps/pep-0008/)。
  - 建议使用 Black (https://github.com/psf/black) 和 Flake8 (https://flake8.pycqa.org/en/latest/) 进行代码格式化和检查。
  - 配置可以在 `pyproject.toml` 中定义。
- **命名约定**:
  - 类名: CapWords (e.g., `OrderProcessor`)
  - 函数/变量: snake_case (e.g., `get_order_details`)
  - 常量: UPPER_SNAKE_CASE (e.g., `DATABASE_URL`)
- **依赖管理**: 使用 `uv` 和 `requirements.txt` 或 `pyproject.toml` (PEP 621) 管理依赖。
  - 更新依赖后，重新生成 `requirements.txt` (如果使用) 或确保 `pyproject.toml` 和 `uv.lock` 更新。
- **测试**: 测试代码应放在 `backend/tests/` 目录下，使用 Pytest 或 unittest。

## 4. 依赖管理

- **前端**: 使用 `pnpm` 管理依赖。新的依赖通过 `pnpm add <package-name>` 添加。
- **后端**: 使用 `uv` 管理依赖。新的依赖添加到 `requirements.txt` 或 `pyproject.toml` 中，然后运行 `uv pip install -r requirements.txt` 或 `uv pip install .`。

## 5. 测试

- 所有新功能和 bug 修复都应附带相应的单元测试、集成测试或端到端测试。
- 前端测试应覆盖组件逻辑和用户交互。
- 后端测试应覆盖 API 端点、业务逻辑和数据处理。

## 6. 文档

- **API 文档**: 后端 API 应有清晰的文档 (例如使用 OpenAPI/Swagger)。
- **代码注释**: 对复杂的逻辑、算法或重要的业务规则进行注释。
- **READMEs**: 各模块 (frontend, backend) 应有自己的 `README.md`，说明其用途、设置和运行方式。

## 7. 代码审查

- 所有代码合并到 `develop` 或 `main` 分支前，必须经过至少一位其他团队成员的审查。
-审查者应关注代码质量、可读性、性能、安全性和是否符合项目规范。

## 8. 环境配置

- **后端**: 环境变量通过 `.env` 文件管理 (基于 `.env.example`)。
- **前端**: 环境变量通过 `.env` 文件 (Vite 支持) 管理。
- **禁止** 将包含敏感信息的 `.env` 文件提交到版本控制系统。

## 9. 构建和部署

- **前端**: 构建命令可能为 `pnpm build` (根据 `package.json` 推断)。部署配置见 `netlify.toml`。
- **后端**: 根据具体框架和部署策略而定 (例如 Docker, Serverless)。

## 10. Trae AI 使用

- 本项目使用 Trae AI 进行辅助开发。
- Trae AI 的相关规则和配置存储在 `.trae/` 目录下。
