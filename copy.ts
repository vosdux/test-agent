// NOT WORKING.
// import fs from 'fs';
// import path from 'path';
// import { parse } from '@babel/parser';
// import traverse from '@babel/traverse';
// import { GigaChat } from 'langchain-gigachat';
// import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
// import { GigaChatEmbeddings } from 'langchain-gigachat/embeddings';
// import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
// import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts';
// import { RunnablePassthrough, RunnableSequence } from '@langchain/core/runnables';
// import { StringOutputParser } from '@langchain/core/output_parsers';
// import { Document } from '@langchain/core/documents';
// import dotenv from 'dotenv';
// import { Agent } from 'node:https';
// import { pull } from 'langchain/hub';
// import { formatDocumentsAsString } from 'langchain/util/document';

// dotenv.config();

// // Типы
// type DependencyGraph = Record<string, {
//   code: string;
//   dependencies: string[];
//   isEntry: boolean;
// }>;

// type TestGenerationContext = {
//   entryPath: string;
//   relevantCode: string;
//   dependencies: string[];
//   testFramework: string;
//   exampleTest?: string;
// };

// class PageTestGenerator {
//   private llm: GigaChat;
//   private vectorStore?: HNSWLib;
//   private readonly MAX_DEPTH = 3;
//   private readonly CHUNK_SIZE = 1000;
//   private readonly CHUNK_OVERLAP = 200;
//   private readonly VECTOR_STORE_DIR = '.test-gen';

//   constructor() {
//     if (!process.env.GIGA_API_KEY) {
//       throw new Error('GIGA_API_KEY is not defined in .env');
//     }

//     const httpsAgent = new Agent({
//       rejectUnauthorized: false, // Отключает проверку корневого сертификата
//       // Читайте ниже как можно включить проверку сертификата Мин. Цифры
//     });

//     this.llm = new GigaChat({
//       credentials: process.env.GIGA_API_KEY,
//       model: 'GigaChat-Lite',
//       temperature: 0.2,
//       topP: 0.8,
//       httpsAgent
//     });
//   }

//   public async initializeVectorStore(projectRoot: string): Promise<void> {
//     console.log('📂 Indexing project files...');

//     const files = this.getProjectCodeFiles(projectRoot);
//     const splitter = new RecursiveCharacterTextSplitter({
//       chunkSize: this.CHUNK_SIZE,
//       chunkOverlap: this.CHUNK_OVERLAP,
//     });

//     const docs: Document[] = [];
//     for (const file of files) {
//       try {
//         const content = fs.readFileSync(file, 'utf-8');
//         const chunks = await splitter.createDocuments(
//           [content],
//           [{ source: path.relative(projectRoot, file) }],
//           { chunkHeader: `FILE: ${file}\n\n` }
//         );
//         docs.push(...chunks);
//       } catch (error) {
//         console.warn(`⚠️ Could not read file: ${file}`);
//       }
//     }

//     const httpsAgent = new Agent({
//       rejectUnauthorized: false,
//     });

//     this.vectorStore = await HNSWLib.fromDocuments(
//       docs,
//       new GigaChatEmbeddings({ credentials: process.env.GIGA_API_KEY, httpsAgent })
//     );

//     // Сохраняем векторный стор
//     await this.saveVectorStore(projectRoot);

//     console.log(`✅ Vector store ready (${docs.length} chunks)`);
//   }

//   private async saveVectorStore(projectRoot: string): Promise<void> {
//     if (!this.vectorStore) return;

//     const storePath = path.join(projectRoot, this.VECTOR_STORE_DIR);
//     this.ensureDirectoryExists(storePath);
//     await this.vectorStore.save(storePath);
//   }

//   private async loadVectorStore(projectRoot: string): Promise<void> {
//     const storePath = path.join(projectRoot, this.VECTOR_STORE_DIR);
//     if (!fs.existsSync(storePath)) {
//       throw new Error('Vector store not found. Run init command first.');
//     }

//     const httpsAgent = new Agent({
//       rejectUnauthorized: false,
//     });

//     this.vectorStore = await HNSWLib.load(
//       storePath,
//       new GigaChatEmbeddings({ credentials: process.env.GIGA_API_KEY, httpsAgent })
//     );
//   }

//   private cleanGeneratedCode(code: string): string {
//     // Remove markdown code block markers
//     return code
//       .replace(/```typescript\n?/g, '')
//       .replace(/```\n?/g, '')
//       .trim();
//   }

//   public async generatePageTests(entryPath: string, exampleTestPath?: string): Promise<{ testCode: string, testFilePath: string }> {
//     const projectRoot = this.findProjectRoot(entryPath);
//     await this.loadVectorStore(projectRoot);

//     console.log(`🔍 Analyzing ${path.basename(entryPath)}...`);

//     // 1. Prepare context
//     const context = await this.prepareTestContext(entryPath, exampleTestPath);

//     // 2. Create generation chain
//     const testChain = this.createTestGenerationChain();

//     const promp2 = pull<ChatPromptTemplate>("gigachat/rag-prompt").then(prompt => {
//       console.log(prompt, 'prompt');
//     });

//     if (!this.vectorStore) {
//       throw new Error('Vector store not initialized');
//     }

//     const retriever = this.vectorStore.asRetriever();
//     const chain = RunnableSequence.from([
//       {
//         context: retriever?.pipe(formatDocumentsAsString),
//         question: new RunnablePassthrough(),
//       },
//       this.llm,
//       new StringOutputParser()
//     ]);

//     const result = await chain.invoke({
//       question: 'Generate a test for the file'
//     });
//     console.log(result, 'result');

//     // 3. Generate tests
//     const rawTestCode = await testChain.invoke(context);
//     const cleanedTestCode = this.cleanGeneratedCode(rawTestCode);

//     // 4. Save results
//     const testFilePath = this.getTestFilePath(entryPath);
//     this.ensureDirectoryExists(testFilePath);
//     fs.writeFileSync(testFilePath, cleanedTestCode);

//     console.log(`✅ Tests saved to ${testFilePath}`);
//     return {
//       testCode: cleanedTestCode,
//       testFilePath
//     };
//   }

//   private async prepareTestContext(entryPath: string, exampleTestPath?: string): Promise<TestGenerationContext> {
//     console.log('📝 Preparing test generation context...');

//     const graph = this.buildDependencyGraph(entryPath);
//     const exampleTest = exampleTestPath ? await this.loadExampleTest(exampleTestPath) : undefined;

//     // Получаем релевантный код из векторного хранилища
//     const relevantCode = await this.retrieveRelevantCode(entryPath, graph);

//     console.log('📋 Context prepared with:');
//     console.log(`- Entry path: ${entryPath}`);
//     console.log(`- Dependencies: ${this.collectDependencies(graph).length} files`);
//     console.log(`- Example test: ${exampleTestPath ? 'provided' : 'not provided'}`);
//     console.log(`- Relevant code chunks: ${relevantCode.split('\n\n').length}`);

//     return {
//       entryPath,
//       relevantCode,
//       dependencies: this.collectDependencies(graph),
//       testFramework: this.detectTestFramework(entryPath),
//       exampleTest
//     };
//   }

//   private async retrieveRelevantCode(entryPath: string, graph: DependencyGraph): Promise<string> {
//     if (!this.vectorStore) {
//       console.warn('⚠️ Vector store not initialized');
//       return '';
//     }

//     const entryCode = graph[path.resolve(entryPath)]?.code || '';
//     const keyConcepts = this.extractKeyConcepts(entryCode);

//     console.log('🔍 Searching for relevant code using concepts:', keyConcepts.join(', '));

//     const relevantDocs = await this.vectorStore.similaritySearch(
//       `Test context for: ${path.basename(entryPath)}\n` +
//       `Key concepts: ${keyConcepts.join(', ')}`,
//       10
//     );

//     console.log(`✅ Found ${relevantDocs.length} relevant code chunks`);

//     return relevantDocs
//       .map(doc => `// ${doc.metadata.source}\n${doc.pageContent}`)
//       .join('\n\n');
//   }

//   private async loadExampleTest(examplePath: string): Promise<string> {
//     try {
//       const absolutePath = path.resolve(examplePath);
//       return fs.readFileSync(absolutePath, 'utf-8');
//     } catch (error) {
//       console.warn(`⚠️ Could not read example test file: ${examplePath}`);
//       return '';
//     }
//   }

//   private createTestGenerationChain() {
//     const prompt = PromptTemplate.fromTemplate(`
// You are a senior QA engineer. Generate comprehensive integration tests for the {testFramework} component.

// File: {entryPath}
// Dependencies: {dependencies}

// Relevant code:
// {relevantCode}

// ${this.getExampleTestPrompt()}

// Requirements:
// 1. User Scenarios Coverage:
//    - CRUD operations (Create, Read, Update, Delete)
//    - Form submissions and validations
//    - Data filtering and sorting
//    - Pagination and infinite scroll
//    - Search functionality
//    - File uploads/downloads if present

// 2. UI Interactions:
//    - All clickable elements (buttons, links, checkboxes)
//    - Form inputs (text fields, selects, radio buttons)
//    - Modal dialogs and popups
//    - Dropdown menus and tooltips
//    - Drag and drop if applicable
//    - Keyboard navigation

// 3. Data Flow:
//    - API calls and responses
//    - Loading states
//    - Error handling
//    - Success messages
//    - Data persistence
//    - Cache management

// 4. Edge Cases:
//    - Empty states
//    - Error states
//    - Network failures
//    - Invalid inputs
//    - Concurrent operations
//    - Session timeouts

// 5. Testing Best Practices:
//    - Use MSW for API mocking
//    - Follow the same style as example test
//    - Use data-testid attributes
//    - Test accessibility
//    - Verify component state changes
//    - Check side effects

// Generate a complete test file that covers all these aspects. Focus on real user interactions and business logic.
// Output ONLY the test code without explanations.
// `);


//     return RunnableSequence.from([
//       {
//         entryPath: (input: TestGenerationContext) => input.entryPath,
//         dependencies: (input: TestGenerationContext) => input.dependencies.join(', '),
//         relevantCode: (input: TestGenerationContext) => input.relevantCode,
//         testFramework: (input: TestGenerationContext) => input.testFramework,
//         exampleTest: (input: TestGenerationContext) => input.exampleTest || this.getTestExample()
//       },
//       async (input) => {
//         const formattedPrompt = await prompt.format(input);
//         console.log('📝 Full prompt:', formattedPrompt);
//         return formattedPrompt;
//       },
//       this.llm,
//       new StringOutputParser()
//     ]);
//   }

//   private createTestImprovementChain() {
//     const prompt = PromptTemplate.fromTemplate(`
// You are a senior QA engineer. Improve the existing test based on the user feedback.

// Current test:
// {currentTest}

// User feedback:
// {feedback}

// Requirements:
// 1. Keep the existing test structure and style
// 2. Address all points from user feedback
// 3. Maintain existing test coverage
// 4. Add new test cases if needed
// 5. Fix any issues mentioned in feedback
// 6. Keep the code clean and well-organized

// Output ONLY the improved test code without explanations.
// `);

//     return RunnableSequence.from([
//       {
//         currentTest: (input: { currentTest: string, feedback: string }) => input.currentTest,
//         feedback: (input: { currentTest: string, feedback: string }) => input.feedback
//       },
//       async (input) => {
//         const formattedPrompt = await prompt.format(input);
//         console.log('📝 Full prompt:', formattedPrompt);
//         return formattedPrompt;
//       },
//       this.llm,
//       new StringOutputParser()
//     ]);
//   }

//   public async improveTest(testPath: string, feedback?: string): Promise<{ testCode: string, testFilePath: string }> {
//     if (!feedback) {
//       throw new Error('Feedback is required for test improvement');
//     }

//     console.log(`🔍 Improving test: ${path.basename(testPath)}...`);

//     try {
//       const currentTest = fs.readFileSync(testPath, 'utf-8');
//       const improvementChain = this.createTestImprovementChain();

//       const improvedTest = await improvementChain.invoke({
//         currentTest,
//         feedback
//       });

//       const cleanedTest = this.cleanGeneratedCode(improvedTest);
//       fs.writeFileSync(testPath, cleanedTest);

//       console.log(`✅ Test improved and saved to ${testPath}`);
//       return {
//         testCode: cleanedTest,
//         testFilePath: testPath
//       };
//     } catch (error) {
//       console.error('Error improving test:', error);
//       throw error;
//     }
//   }

//   private getExampleTestPrompt(): string {
//     return `
// Example test file to follow:
// \`\`\`typescript
// {exampleTest}
// \`\`\`
// `;
//   }

//   private detectTestFramework(filePath: string): string {
//     const ext = path.extname(filePath).toLowerCase();
//     switch (ext) {
//       case '.tsx':
//       case '.jsx':
//         return 'React';
//       case '.vue':
//         return 'Vue 3';
//       case '.svelte':
//         return 'Svelte';
//       default:
//         return 'JavaScript';
//     }
//   }

//   private getTestExample(): string {
//     return `import { render, screen } from '@testing-library/react';
// import userEvent from '@testing-library/user-event';
// import Component from './Component';

// describe('Component Integration Tests', () => {
//   test('should handle main flow', async () => {
//     render(<Component />);
//     // Test implementation
//   });
// });`;
//   }

//   private getProjectCodeFiles(dir: string): string[] {
//     const files: string[] = [];
//     const walkSync = (currentDir: string) => {
//       fs.readdirSync(currentDir, { withFileTypes: true }).forEach(entry => {
//         const fullPath = path.join(currentDir, entry.name);
//         if (entry.isDirectory()) {
//           if (!['node_modules', '.git'].includes(entry.name)) {
//             walkSync(fullPath);
//           }
//         } else if (this.isCodeFile(fullPath)) {
//           files.push(fullPath);
//         }
//       });
//     };
//     walkSync(dir);
//     return files;
//   }

//   private isCodeFile(filePath: string): boolean {
//     const ext = path.extname(filePath).toLowerCase();
//     return ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'].includes(ext);
//   }

//   private buildDependencyGraph(
//     entryPath: string,
//     depth: number = 0,
//     graph: DependencyGraph = {}
//   ): DependencyGraph {
//     if (depth > this.MAX_DEPTH) {
//       console.log(`⚠️ Max depth (${this.MAX_DEPTH}) reached for ${entryPath}`);
//       return graph;
//     }

//     const absolutePath = path.resolve(entryPath);
//     if (graph[absolutePath]) {
//       console.log(`ℹ️ File already analyzed: ${absolutePath}`);
//       return graph;
//     }

//     try {
//       if (!fs.existsSync(absolutePath)) {
//         console.warn(`⚠️ File not found: ${absolutePath}`);
//         return graph;
//       }

//       const code = fs.readFileSync(absolutePath, 'utf-8');
//       const dependencies = this.analyzeDependencies(code);

//       graph[absolutePath] = {
//         code,
//         dependencies: [],
//         isEntry: depth === 0
//       };

//       console.log(`✅ Analyzed: ${path.relative(process.cwd(), absolutePath)}`);

//       dependencies.internal.forEach(dep => {
//         const depPath = this.resolveDependencyPath(dep, absolutePath);
//         if (depPath) {
//           graph[absolutePath].dependencies.push(depPath);
//           this.buildDependencyGraph(depPath, depth + 1, graph);
//         } else {
//           console.warn(`⚠️ Could not resolve dependency: ${dep} in ${absolutePath}`);
//         }
//       });

//       return graph;
//     } catch (error) {
//       console.warn(`⚠️ Error analyzing ${absolutePath}:`, error instanceof Error ? error.message : 'Unknown error');
//       return graph;
//     }
//   }

//   private analyzeDependencies(code: string): { internal: string[]; external: string[] } {
//     try {
//       const ast = parse(code, {
//         sourceType: 'module',
//         plugins: ['jsx', 'typescript', 'decorators-legacy'],
//       });

//       const result = {
//         internal: [] as string[],
//         external: [] as string[],
//       };

//       const addDependency = (source: string | null) => {
//         if (!source) return;
//         if (source.startsWith('.') || source.startsWith('/')) {
//           result.internal.push(source);
//         } else {
//           result.external.push(source);
//         }
//       };

//       traverse(ast, {
//         ImportDeclaration({ node }) {
//           addDependency(node.source.value);
//         },
//         ExportNamedDeclaration({ node }) {
//           if (node.source) addDependency(node.source.value);
//         },
//         ExportAllDeclaration({ node }) {
//           if (node.source) addDependency(node.source.value);
//         },
//         CallExpression({ node }) {
//           if (node.callee.type === 'Identifier' &&
//             node.callee.name === 'require' &&
//             node.arguments[0]?.type === 'StringLiteral') {
//             addDependency(node.arguments[0].value);
//           }
//         },
//       });

//       return result;
//     } catch (error) {
//       console.warn('⚠️ Error parsing dependencies:', error instanceof Error ? error.message : 'Unknown error');
//       return { internal: [], external: [] };
//     }
//   }

//   private resolveDependencyPath(dependency: string, baseFilePath: string): string | null {
//     const baseDir = path.dirname(baseFilePath);
//     const extensions = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', ''];

//     // Skip node_modules dependencies
//     if (dependency.startsWith('@') || !dependency.startsWith('.')) {
//       return null;
//     }

//     for (const ext of extensions) {
//       const fullPath = path.resolve(baseDir, `${dependency}${ext}`);
//       if (fs.existsSync(fullPath)) {
//         console.log(`✅ Found dependency: ${path.relative(process.cwd(), fullPath)}`);
//         return fullPath;
//       }

//       const indexPath = path.resolve(baseDir, dependency, `index${ext}`);
//       if (fs.existsSync(indexPath)) {
//         console.log(`✅ Found dependency index: ${path.relative(process.cwd(), indexPath)}`);
//         return indexPath;
//       }
//     }

//     return null;
//   }

//   private extractKeyConcepts(code: string): string[] {
//     const concepts = new Set<string>();
//     try {
//       const ast = parse(code, {
//         sourceType: 'module',
//         plugins: ['jsx', 'typescript', 'decorators-legacy'],
//       });

//       traverse(ast, {
//         FunctionDeclaration(path) {
//           if (path.node.id?.name) concepts.add(path.node.id.name);
//         },
//         VariableDeclarator(path) {
//           if (path.node.id.type === 'Identifier') concepts.add(path.node.id.name);
//         },
//         ClassDeclaration(path) {
//           if (path.node.id?.name) concepts.add(path.node.id.name);
//         },
//         JSXIdentifier(path) {
//           concepts.add(path.node.name);
//         },
//         CallExpression(path) {
//           if (path.node.callee.type === 'Identifier') {
//             concepts.add(path.node.callee.name);
//           }
//         }
//       });
//     } catch (error) {
//       console.error('Error extracting concepts:', error);
//     }
//     return Array.from(concepts);
//   }

//   private collectDependencies(graph: DependencyGraph): string[] {
//     return [...new Set(
//       Object.values(graph).flatMap(file => file.dependencies)
//     )];
//   }

//   private getTestFilePath(originalPath: string): string {
//     const parsed = path.parse(originalPath);
//     return path.join(parsed.dir, '__tests__', `${parsed.name}.integration.test${parsed.ext}`);
//   }

//   private ensureDirectoryExists(filePath: string): void {
//     const dir = path.dirname(filePath);
//     if (!fs.existsSync(dir)) {
//       fs.mkdirSync(dir, { recursive: true });
//     }
//   }

//   private findProjectRoot(filePath: string): string {
//     let currentDir = path.dirname(filePath);
//     while (currentDir !== path.parse(currentDir).root) {
//       if (fs.existsSync(path.join(currentDir, this.VECTOR_STORE_DIR))) {
//         return currentDir;
//       }
//       currentDir = path.dirname(currentDir);
//     }
//     throw new Error('Project root not found. Run init command first.');
//   }
// }

// export default PageTestGenerator;