import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { GigaChat } from 'langchain-gigachat';
import { Agent } from 'https';
import dotenv from 'dotenv';

dotenv.config();

type DependencyGraph = Record<string, {
  code: string;
  dependencies: string[];
}>;

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

export class AstTestGenerator {
  private llm: GigaChat;
  private readonly MAX_DEPTH = 3;
  private readonly MAX_CONTEXT_LENGTH = 15000;

  constructor() {
    if (!process.env.GIGA_API_KEY) {
      throw new Error('GIGA_API_KEY is not defined in .env');
    }

    this.llm = new GigaChat({
      credentials: process.env.GIGA_API_KEY,
      model: 'GigaChat-2',
      temperature: 0.2,
      topP: 0.8,
      httpsAgent: new Agent({ rejectUnauthorized: false }),
      timeout: 300000,
    });
  }

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

  private async buildTestContext(
    entryPath: string,
    options: TestGenerationOptions
  ): Promise<TestGenerationContext> {
    const graph = this.buildDependencyGraph(entryPath);
    const entryCode = graph[entryPath]?.code || '';
    
    const testUtils = options.testUtilsPaths 
      ? await this.loadTestFiles(options.testUtilsPaths)
      : undefined;

    const referenceTests = options.referenceTestsPaths
      ? await this.loadTestFiles(options.referenceTestsPaths)
      : undefined;

    console.log('\n📋 Test context:');
    console.log('------------------------');
    if (testUtils) {
      console.log('\n🔧 Test utilities:');
      testUtils.forEach((code, index) => {
        const fileName = code.split('\n')[0].replace('// ', '');
        console.log(`${index + 1}. ${fileName}`);
      });
    }

    if (referenceTests) {
      console.log('\n📚 Reference tests:');
      referenceTests.forEach((code, index) => {
        const fileName = code.split('\n')[0].replace('// ', '');
        console.log(`${index + 1}. ${fileName}`);
      });
    }
    console.log('------------------------\n');
    
    return {
      entryCode,
      dependenciesCode: this.getDependenciesCode(graph, entryPath),
      testFramework: this.detectTestFramework(entryPath),
      entryPath,
      testUtils,
      referenceTests
    };
  }

  private async loadTestFiles(filePaths: string[]): Promise<string[]> {
    return Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          return `// ${filePath}\n${content}`;
        } catch (error) {
          console.warn(`⚠️ Could not read test file: ${filePath}`);
          return '';
        }
      })
    ).then(files => files.filter(content => content.length > 0));
  }

  private buildDependencyGraph(
    entryPath: string,
    depth = 0,
    graph: DependencyGraph = {}
  ): DependencyGraph {
    // if (depth > this.MAX_DEPTH) return graph;
    
    const absolutePath = path.resolve(entryPath);
    if (graph[absolutePath]) return graph;
    
    try {
      const code = fs.readFileSync(absolutePath, 'utf-8');
      const dependencies = this.analyzeDependencies(code);
      
      graph[absolutePath] = { code, dependencies: [] };
      
      dependencies.forEach(dep => {
        const depPath = this.resolveDependency(dep, absolutePath);
        if (depPath) {
          graph[absolutePath].dependencies.push(depPath);
          this.buildDependencyGraph(depPath, depth + 1, graph);
        }
      });
      
      return graph;
    } catch (error) {
      console.warn(`⚠️ Could not analyze: ${absolutePath}`);
      return graph;
    }
  }

  private analyzeDependencies(code: string): string[] {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy']
    });

    const dependencies = new Set<string>();

    traverse(ast, {
      ImportDeclaration({ node }) {
        if (node.source.value) dependencies.add(node.source.value);
      },
      ExportNamedDeclaration({ node }) {
        if (node.source?.value) dependencies.add(node.source.value);
      },
      CallExpression({ node }) {
        if (node.callee.type === 'Identifier' && 
            node.callee.name === 'require' &&
            node.arguments[0]?.type === 'StringLiteral') {
          dependencies.add(node.arguments[0].value);
        }
      }
    });

    return Array.from(dependencies).filter(dep => !dep.startsWith('@'));
  }

  private resolveDependency(dependency: string, basePath: string): string | null {
    const baseDir = path.dirname(basePath);
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.vue', ''];

    // Пропускаем npm-пакеты
    if (!dependency.startsWith('.')) return null;

    for (const ext of extensions) {
      const fullPath = path.resolve(baseDir, `${dependency}${ext}`);
      if (fs.existsSync(fullPath)) return fullPath;

      const indexPath = path.resolve(baseDir, dependency, `index${ext}`);
      if (fs.existsSync(indexPath)) return indexPath;
    }

    return null;
  }

  private getDependenciesCode(graph: DependencyGraph, entryPath: string): string[] {
    const dependencies = graph[path.resolve(entryPath)]?.dependencies || [];
    return dependencies
      .filter(dep => dep !== entryPath)
      .map(dep => `// ${dep}\n${graph[dep]?.code || ''}`)
      .filter(code => code.length > 0);
  }

  private async generateTestCode(context: TestGenerationContext): Promise<string> {
    const { 
      entryCode, 
      dependenciesCode, 
      testFramework, 
      entryPath,
      testUtils,
      referenceTests 
    } = context;
    const fileName = path.basename(entryPath);

    console.log('\n📋 Files included in prompt:');
    console.log('------------------------');
    console.log(`📄 Main component: ${fileName}`);
    console.log(`📝 Code length: ${entryCode.length} characters`);
    
    if (dependenciesCode.length > 0) {
      console.log('\n📦 Dependencies:');
      dependenciesCode.forEach((code, index) => {
        const depName = code.split('\n')[0].replace('// ', '');
        console.log(`${index + 1}. ${depName}`);
        console.log(`   📝 Code length: ${code.length} characters`);
      });
    } else {
      console.log('\nℹ️ No dependencies found');
    }

    console.log('\n🔍 Total context size:', 
      entryCode.length + dependenciesCode.reduce((sum, code) => sum + code.length, 0),
      'characters'
    );
    console.log('------------------------\n');

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
${dependenciesCode.join('\n\n')}
\`\`\`

${testUtils ? `Test utilities:
\`\`\`typescript
${testUtils.join('\n\n')}
\`\`\`
` : ''}

${referenceTests ? `Reference tests:
\`\`\`typescript
${referenceTests.join('\n\n')}
\`\`\`
` : ''}

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
   - Use MSW for API mocking
   - Follow the same style as example test
   - Use data-testid attributes
   - Test accessibility
   - Verify component state changes
   - Check side effects

6. dont test aria-attributes

Generate a complete test file that covers all these aspects. Focus on real user interactions and business logic.
Output ONLY the test code without explanations.
`;

    console.log('🤖 Sending prompt to GigaChat...');
    const response = await this.llm.invoke(prompt);
    
    if (typeof response.content === 'string') {
      const cleanedCode = this.cleanGeneratedCode(response.content || 'error');
      console.log('✅ Test code generated successfully');
      return cleanedCode;
    }

    console.error('❌ Failed to generate test code');
    return 'error';
  }

  private truncateCode(code: string): string {
    return code.length > this.MAX_CONTEXT_LENGTH 
      ? code.substring(0, this.MAX_CONTEXT_LENGTH) + '\n// ... (truncated)'
      : code;
  }

  private cleanGeneratedCode(code: string): string {
    return code
      .replace(/```[^\n]*/g, '')
      .trim();
  }

  private detectTestFramework(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.vue' ? 'Vue' : 
           ext === '.svelte' ? 'Svelte' : 'React';
  }

  private getTestFilePath(originalPath: string, options: TestGenerationOptions = {}): string {
    if (options.outputPath) {
      return options.outputPath;
    }
    
    const parsed = path.parse(originalPath);
    return path.join(parsed.dir, '__tests__', `${parsed.name}.test${parsed.ext}`);
  }

  private ensureDirectoryExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public async improveTest(testPath: string, feedback: string): Promise<string> {
    if (!feedback) {
      throw new Error('Feedback is required for test improvement');
    }

    console.log(`🔍 Improving test: ${path.basename(testPath)}...`);

    try {
      const currentTest = await fs.promises.readFile(testPath, 'utf-8');
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

      console.log('🤖 Sending prompt to GigaChat...');
      const response = await this.llm.invoke(prompt);
      
      if (typeof response.content === 'string') {
        const cleanedCode = this.cleanGeneratedCode(response.content || 'error');
        await fs.promises.writeFile(testPath, cleanedCode);
        console.log('✅ Test improved successfully');
        return testPath;
      }

      throw new Error('Failed to generate improved test');
    } catch (error) {
      console.error('Error improving test:', error);
      throw error;
    }
  }
}