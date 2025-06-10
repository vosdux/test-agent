import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { GigaChat } from "langchain-gigachat";
import { Agent } from "https";
import dotenv from "dotenv";

dotenv.config();

type DependencyGraph = Record<
  string,
  {
    code: string;
    dependencies: string[];
  }
>;

type TestGenerationOptions = {
  exampleTestPath?: string;
  testUtilsPaths?: string[];
  referenceTestsPaths?: string[];
  outputPath?: string;
};

type TestGenerationContext = {
  entryCode: string;
  dependenciesCode: string[];
  testFramework: string;
  entryPath: string;
  testUtils?: string[];
  referenceTests?: string[];
};

/**
 * Класс для автоматической генерации тестов путем анализа зависимостей кода и использования ИИ.
 * Использует GigaChat для генерации тестов и поддерживает различные тестовые фреймворки.
 */
export class AstTestGenerator {
  private llm: GigaChat;
  private readonly MAX_DEPTH = 5;
  private readonly MAX_CONTEXT_LENGTH = 15000;

  /**
   * Создает новый экземпляр AstTestGenerator.
   * Инициализирует клиент GigaChat с конфигурацией из переменных окружения.
   * @throws {Error} Если GIGA_API_KEY не определен в переменных окружения
   */
  constructor() {
    if (!process.env.GIGA_API_KEY) {
      throw new Error("GIGA_API_KEY is not defined in .env");
    }

    this.llm = new GigaChat({
      credentials: process.env.GIGA_API_KEY,
      model: "GigaChat-2",
      temperature: 0.2,
      topP: 0.8,
      httpsAgent: new Agent({ rejectUnauthorized: false }),
      timeout: 300000,
    });
  }

  /**
   * Генерирует тестовые файлы для указанного входного файла.
   * @param entryPath - Путь к файлу, для которого нужно сгенерировать тесты
   * @param options - Дополнительные настройки для генерации тестов
   * @returns Promise<string> - Путь к сгенерированному тестовому файлу
   */
  public async generateTests(
    entryPath: string,
    options: TestGenerationOptions = {}
  ): Promise<string> {
    const absolutePath = path.resolve(entryPath);
    const context = await this.buildTestContext(absolutePath, options);
    const testCode = await this.generateTestCode(context);
    const testFilePath = this.getTestFilePath(absolutePath, options);
    this.ensureDirectoryExists(testFilePath);
    fs.writeFileSync(testFilePath, testCode);

    return testFilePath;
  }

  /**
   * Создает контекст для генерации тестов путем анализа зависимостей и загрузки тестовых утилит.
   * @param entryPath - Путь к основному файлу, который тестируется
   * @param options - Настройки для генерации тестов
   * @returns Promise<TestGenerationContext> - Контекст, содержащий всю необходимую информацию для генерации тестов
   */
  private async buildTestContext(
    entryPath: string,
    options: TestGenerationOptions
  ): Promise<TestGenerationContext> {
    const graph = this.buildDependencyGraph(entryPath);
    const entryCode = graph[entryPath]?.code || "";

    const testUtils = options.testUtilsPaths
      ? await this.loadTestFiles(options.testUtilsPaths)
      : undefined;

    const referenceTests = options.referenceTestsPaths
      ? await this.loadTestFiles(options.referenceTestsPaths)
      : undefined;

    console.log("\n📋 Test context:");
    console.log("------------------------");
    if (testUtils) {
      console.log("\n🔧 Test utilities:");
      testUtils.forEach((code, index) => {
        const fileName = code.split("\n")[0].replace("// ", "");
        console.log(`${index + 1}. ${fileName}`);
      });
    }

    if (referenceTests) {
      console.log("\n📚 Reference tests:");
      referenceTests.forEach((code, index) => {
        const fileName = code.split("\n")[0].replace("// ", "");
        console.log(`${index + 1}. ${fileName}`);
      });
    }
    console.log("------------------------\n");

    return {
      entryCode,
      dependenciesCode: this.getDependenciesCode(graph, entryPath),
      testFramework: this.detectTestFramework(entryPath),
      entryPath,
      testUtils,
      referenceTests,
    };
  }

  /**
   * Загружает файлы тестовых утилит и эталонных тестов из указанных путей.
   * @param filePaths - Массив путей к файлам тестовых утилит
   * @returns Promise<string[]> - Массив содержимого файлов с их путями в виде комментариев
   */
  private async loadTestFiles(filePaths: string[]): Promise<string[]> {
    return Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const content = await fs.promises.readFile(filePath, "utf-8");
          return `// ${filePath}\n${content}`;
        } catch (error) {
          console.warn(`⚠️ Could not read test file: ${filePath}`);
          return "";
        }
      })
    ).then((files) => files.filter((content) => content.length > 0));
  }

  /**
   * Строит граф зависимостей для заданного входного файла.
   * @param entryPath - Путь к входному файлу
   * @param depth - Текущая глубина рекурсии (по умолчанию: 0)
   * @param graph - Существующий граф зависимостей (по умолчанию: {})
   * @returns DependencyGraph - Карта путей файлов к их коду и зависимостям
   */
  private buildDependencyGraph(
    entryPath: string,
    depth = 0,
    graph: DependencyGraph = {}
  ): DependencyGraph {
    if (depth > this.MAX_DEPTH) {
      console.log(`⚠️ Max depth (${this.MAX_DEPTH}) reached for: ${entryPath}`);
      return graph;
    }

    const absolutePath = path.resolve(entryPath);
    if (graph[absolutePath]) {
      console.log(`⏭️ Already processed: ${absolutePath}`);
      return graph;
    }

    try {
      console.log(`\n🔍 Processing file (depth ${depth}): ${absolutePath}`);
      const code = fs.readFileSync(absolutePath, "utf-8");
      const dependencies = this.analyzeDependencies(code);

      graph[absolutePath] = { code, dependencies: [] };

      console.log(`📦 Found ${dependencies.length} dependencies:`);
      dependencies.forEach((dep) => {
        const depPath = this.resolveDependency(dep, absolutePath);
        if (depPath) {
          console.log(`  ✅ Resolved: ${dep} -> ${depPath}`);
          graph[absolutePath].dependencies.push(depPath);
          // Рекурсивно обрабатываем зависимости
          this.buildDependencyGraph(depPath, depth + 1, graph);
        } else {
          console.log(`  ❌ Could not resolve: ${dep}`);
        }
      });

      return graph;
    } catch (error) {
      console.warn(`⚠️ Could not analyze: ${absolutePath}`);
      console.warn(
        `   Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return graph;
    }
  }

  /**
   * Анализирует код для поиска всех импортов и require-выражений.
   * @param code - Исходный код для анализа
   * @returns string[] - Массив путей зависимостей
   */
  private analyzeDependencies(code: string): string[] {
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
    });

    const dependencies = new Set<string>();

    traverse(ast, {
      ImportDeclaration({ node }) {
        if (node.source.value) {
          console.log(`📦 Found import: ${node.source.value}`);
          dependencies.add(node.source.value);
        }
      },
      ExportNamedDeclaration({ node }) {
        if (node.source?.value) {
          console.log(`📦 Found export: ${node.source.value}`);
          dependencies.add(node.source.value);
        }
      },
      CallExpression({ node }) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "StringLiteral"
        ) {
          console.log(`📦 Found require: ${node.arguments[0].value}`);
          dependencies.add(node.arguments[0].value);
        }
      },
    });

    // Фильтруем только npm-пакеты, начинающиеся с @
    // const npmDependencies = Array.from(dependencies).filter(dep => !dep.startsWith('@'));
    // Оставляем все относительные импорты
    const relativeDependencies = Array.from(dependencies).filter((dep) =>
      dep.startsWith(".")
    );

    console.log("\n🔍 Dependencies analysis:");
    console.log("------------------------");
    // console.log('📦 NPM packages:', npmDependencies);
    console.log("📦 Relative imports:", relativeDependencies);
    console.log("------------------------\n");

    return relativeDependencies;
  }

  /**
   * Разрешает путь зависимости относительно базового файла.
   * @param dependency - Путь зависимости для разрешения
   * @param basePath - Путь базового файла
   * @returns string | null - Абсолютный путь или null, если не найден
   */
  private resolveDependency(
    dependency: string,
    basePath: string
  ): string | null {
    const baseDir = path.dirname(basePath);
    const extensions = [".js", ".jsx", ".ts", ".tsx", ".vue", ""];

    // Пропускаем npm-пакеты
    if (!dependency.startsWith(".")) {
      console.log(`⏭️ Skipping npm package: ${dependency}`);
      return null;
    }

    console.log(`🔍 Resolving dependency: ${dependency}`);
    console.log(`📂 Base directory: ${baseDir}`);

    for (const ext of extensions) {
      const fullPath = path.resolve(baseDir, `${dependency}${ext}`);
      if (fs.existsSync(fullPath)) {
        console.log(`✅ Found file: ${fullPath}`);
        return fullPath;
      }

      const indexPath = path.resolve(baseDir, dependency, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        console.log(`✅ Found index file: ${indexPath}`);
        return indexPath;
      }
    }

    console.log(`❌ Could not resolve: ${dependency}`);
    return null;
  }

  /**
   * Извлекает код из зависимостей в графе зависимостей.
   * @param graph - Граф зависимостей
   * @param entryPath - Путь к входному файлу
   * @returns string[] - Массив кода зависимостей с их путями в виде комментариев
   */
  private getDependenciesCode(
    graph: DependencyGraph,
    entryPath: string
  ): string[] {
    const processed = new Set<string>();

    const collectDependencies = (currentPath: string): string[] => {
      if (processed.has(currentPath)) {
        return [];
      }

      processed.add(currentPath);
      const dependencies = graph[currentPath]?.dependencies || [];

      const currentCode = `// ${currentPath}\n${graph[currentPath]?.code || ""
        }`;
      const nestedDependencies = dependencies
        .filter((dep) => dep !== entryPath)
        .flatMap((dep) => collectDependencies(dep));

      return [currentCode, ...nestedDependencies];
    };

    const absolutePath = path.resolve(entryPath);
    const allDependencies = collectDependencies(absolutePath);

    return allDependencies.filter((code) => code.length > 0);
  }

  /**
   * Генерирует тестовый код с использованием модели GigaChat.
   * @param context - Контекст генерации тестов
   * @returns Promise<string> - Сгенерированный тестовый код
   */
  private async generateTestCode(
    context: TestGenerationContext
  ): Promise<string> {
    const {
      entryCode,
      dependenciesCode,
      testFramework,
      entryPath,
      testUtils,
      referenceTests,
    } = context;
    const fileName = path.basename(entryPath);

    console.log("\n📋 Files included in prompt:");
    console.log("------------------------");
    console.log(`📄 Main component: ${fileName}`);
    console.log(`📝 Code length: ${entryCode.length} characters`);

    if (dependenciesCode.length > 0) {
      console.log("\n📦 Dependencies:");
      dependenciesCode.forEach((code, index) => {
        const depName = code.split("\n")[0].replace("// ", "");
        console.log(`${index + 1}. ${depName}`);
        console.log(`   📝 Code length: ${code.length} characters`);
      });
    } else {
      console.log("\nℹ️ No dependencies found");
    }

    console.log(
      "\n🔍 Total context size:",
      entryCode.length +
      dependenciesCode.reduce((sum, code) => sum + code.length, 0),
      "characters"
    );
    console.log("------------------------\n");

    const prompt = `
You are a senior QA engineer. Generate comprehensive integration tests for the ${testFramework} component.

File: ${fileName}
Test framework: Vitest + React Testing Library + MSW

Main component code:
\`\`\`typescript
${entryCode}
\`\`\`

Dependencies:
\`\`\`typescript
${dependenciesCode.join("\n\n")}
\`\`\`

${testUtils
        ? `Test utilities:
\`\`\`typescript
${testUtils.join("\n\n")}
\`\`\`
`
        : ""
      }

${referenceTests
        ? `Reference tests:
\`\`\`typescript
${referenceTests.join("\n\n")}
\`\`\`
`
        : ""
      }

Requirements:
1. User Scenarios Coverage:
   - CRUD operations (Create, Read, Update, Delete)
   - Form submissions and validations
   - Data filtering and sorting
   - Pagination and infinite scroll
   - Search functionality
   - File uploads/downloads if present

2. UI Interactions:
   - All clickable elements (buttons, links, checkboxes)
   - Form inputs (text fields, selects, radio buttons)
   - Modal dialogs and popups
   - Dropdown menus and tooltips
   - Drag and drop if applicable
   - Keyboard navigation

3. Data Flow:
   - API calls and responses
   - Loading states
   - Error handling
   - Success messages
   - Data persistence
   - Cache management

4. Edge Cases:
   - Empty states
   - Error states
   - Network failures
   - Invalid inputs
   - Concurrent operations
   - Session timeouts

5. Testing Best Practices:
   - Use MSW version 2 for API mocking
   - Follow the same style as example test
   - Use data-testid attributes
   - Test accessibility
   - Verify component state changes
   - Check side effects

6. dont test aria-attributes


Generate a complete test file that covers all these aspects. Focus on real user interactions and business logic.
Output ONLY the test code without explanations.
`;

    console.log("🤖 Sending prompt to GigaChat...");
    const response = await this.llm.invoke(prompt);

    const improvePrompt = `
      You are a senior QA engineer. Improve the existing test.

      Current test:
      \`\`\`typescript
      ${response.content}
      \`\`\`

      Requirements:
      Check server mock with msw. dont user rest and ctx function.
      It is old version of msw. Use http and HttpResponse from msw.

      Bad mocking example:
      \`\`\`typescript
      const server = setupServer(
        rest.get('https://jsonplaceholder.typicode.com/todos?_limit=10', (req, res, ctx) => {
          return res(ctx.json([{ id: 1, title: 'Task 1', completed: false }, { id: 2, title: 'Task 2', completed: true }, { id: 3, title: 'Task 3', completed: false }]))
        }),
      )

      // bad use request to get data example
      http.post('https://jsonplaceholder.typicode.com/todos', (request) => {
        const body = JSON.parse(request.body);
        return HttpResponse.json({ id: 4, text: body.title, completed: false });
      }),

      // bad get params example
      http.put('https://jsonplaceholder.typicode.com/todos/:id', (request) => {
        const params = request.params;
        const body = JSON.parse(request.body);
        return HttpResponse.json({
          id: parseInt(params.id),
          text: body.title,
          completed: body.completed,
        });
      }),

      // bad get empty data example
      http.delete('https://jsonplaceholder.typicode.com/todos/:id', () => {
        return HttpResponse.empty();
      }),
      \`\`\`

      Good mocking example:
      \`\`\`typescript
        import { http, HttpResponse } from 'msw'
        import { setupServer } from 'msw/node'

        const handlers = [
          // success response
          http.get('https://jsonplaceholder.typicode.com/todos?_limit=10', () =>
            HttpResponse.json([
              { id: 1, title: 'Task 1', completed: false },
              { id: 2, title: 'Task 2', completed: true },
              { id: 3, title: 'Task 3', completed: false },
            ]),
          ),

          // error response with status 401
          http.get('https://jsonplaceholder.typicode.com/todos?_limit=10', () =>
            HttpResponse.json(
              { error: 'Unauthorized' },
              { status: 401 },
            ),
          ),

          // network error
          http.get('https://jsonplaceholder.typicode.com/todos?_limit=10', () =>
            HttpResponse.error(),
          ),

          // use request to get data
          http.get('https://jsonplaceholder.typicode.com/todos?_limit=10', async ({ request }) => {
            const data = await request.clone().json();

            if (data?.id === 'abc-123') {
              return HttpResponse.json({ id: 'abc-123' })
            }

            return HttpResponse.json({ id: 'not-found' })
            }
          ),

          // good get params example
          http.put('https://jsonplaceholder.typicode.com/todos/:id', async ({ request, params }) => {
            const { id } = params;
            const body = await request.clone().json();
            return HttpResponse.json({
              id,
              text: body.title,
              completed: body.completed,
            });
          }),

          // good get empty data example
          http.delete('https://jsonplaceholder.typicode.com/todos/:id', () => {
            return HttpResponse.json();
          }),
        ]

        setupServer(...handlers)
      \`\`\`

      Improve the test by using good mocking example.
      
      Output ONLY the improved test code without explanations.
    `;

    console.log("🤖 Sending improve prompt to GigaChat...");
    const improveResponse = await this.llm.invoke(improvePrompt);

    if (typeof improveResponse.content === "string") {
      const cleanedCode = this.cleanGeneratedCode(
        improveResponse.content || "error"
      );
      console.log("✅ Test code generated successfully");
      return cleanedCode;
    }

    console.error("❌ Failed to generate test code");
    return "error";
  }

  /**
   * Обрезает код, если он превышает максимальную длину контекста.
   * @param code - Код для обрезки
   * @returns string - Обрезанный код с комментарием при необходимости
   */
  private truncateCode(code: string): string {
    return code.length > this.MAX_CONTEXT_LENGTH
      ? code.substring(0, this.MAX_CONTEXT_LENGTH) + "\n// ... (truncated)"
      : code;
  }

  /**
   * Очищает сгенерированный код, удаляя маркеры блоков кода markdown.
   * @param code - Сгенерированный код для очистки
   * @returns string - Очищенный код
   */
  private cleanGeneratedCode(code: string): string {
    return code.replace(/```[^\n]*/g, "").trim();
  }

  /**
   * Определяет тестовый фреймворк на основе расширения файла.
   * @param filePath - Путь к файлу
   * @returns string - Определенный фреймворк ('Vue', 'Svelte' или 'React')
   */
  private detectTestFramework(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".vue" ? "Vue" : ext === ".svelte" ? "Svelte" : "React";
  }

  /**
   * Определяет путь для выходного тестового файла.
   * @param originalPath - Путь к оригинальному файлу
   * @param options - Настройки генерации тестов
   * @returns string - Путь, куда должен быть записан тестовый файл
   */
  private getTestFilePath(
    originalPath: string,
    options: TestGenerationOptions = {}
  ): string {
    if (options.outputPath) {
      return options.outputPath;
    }

    const parsed = path.parse(originalPath);
    return path.join(
      parsed.dir,
      "__tests__",
      `${parsed.name}.test${parsed.ext}`
    );
  }

  /**
   * Проверяет существование директории для файла, создавая её при необходимости.
   * @param filePath - Путь к файлу
   */
  private ensureDirectoryExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Улучшает существующий тест на основе обратной связи пользователя.
   * @param testPath - Путь к тестовому файлу для улучшения
   * @param feedback - Обратная связь пользователя для улучшения теста
   * @returns Promise<string> - Путь к улучшенному тестовому файлу
   * @throws {Error} Если обратная связь пуста или улучшение теста не удалось
   */
  public async improveTest(
    testPath: string,
    feedback: string
  ): Promise<string> {
    if (!feedback) {
      throw new Error("Feedback is required for test improvement");
    }

    console.log(`🔍 Improving test: ${path.basename(testPath)}...`);

    try {
      const currentTest = await fs.promises.readFile(testPath, "utf-8");
      console.log(currentTest, 'currentTest')
      const prompt = `
You are a senior QA engineer. Improve the existing test based on the user feedback.

Current test:
\`\`\`typescript
${currentTest}
\`\`\`

User feedback:
${feedback}

Requirements:
1. Keep the existing test structure and style
2. Address all points from user feedback
3. Maintain existing test coverage
4. Add new test cases if needed
5. Fix any issues mentioned in feedback
6. Keep the code clean and well-organized

Output ONLY the improved test code without explanations.
`;

      console.log("🤖 Sending prompt to GigaChat...");
      const response = await this.llm.invoke(prompt);

      if (typeof response.content === "string") {
        const cleanedCode = this.cleanGeneratedCode(
          response.content || "error"
        );
        await fs.promises.writeFile(testPath, cleanedCode);
        console.log("✅ Test improved successfully");
        return testPath;
      }

      throw new Error("Failed to generate improved test");
    } catch (error) {
      console.error("Error improving test:", error);
      throw error;
    }
  }
}
