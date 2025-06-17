#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import { AstTestGenerator } from './index';
import readline from 'readline';

const program = new Command();

program
  .name('test-gen')
  .description('CLI for generating integration tests')
  .version('1.0.0');

// program
//   .command('init')
//   .description('Initialize vector store for the project')
//   .argument('<projectPath>', 'Path to the project root')
//   .action(async (projectPath: string) => {
//     try {
//       const generator = new PageTestGenerator();
//       await generator.initializeVectorStore(path.resolve(projectPath));
//       console.log('✅ Vector store initialized successfully');
//     } catch (error) {
//       console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
//       process.exit(1);
//     }
//   });

/*
Тестовые утилиты (-u, --utils):
Модель будет использовать ваши кастомные утилиты
Сможет применять ваши хелперы и моки
Сохранит единый стиль тестирования

Референсные тесты (-t, --tests):
Модель изучит существующие тесты
Сможет следовать вашему стилю тестирования
Воспроизведет похожие паттерны

Пример теста (-e, --example):
Модель будет следовать конкретному примеру
Сохранит структуру и стиль
Использует те же подходы к тестированию
*/
program
  .command('generate')
  .description('Generate integration tests for a component')
  .argument('<componentPath>', 'Path to the component file')
  .option('-u, --utils <paths...>', 'Paths to test utility files')
  .option('-t, --tests <paths...>', 'Paths to existing test files for reference')
  .option('-i, --interactive', 'Enable interactive mode for test improvements')
  .option('-o, --output <path>', 'Path where to save the test file (default: __tests__/ComponentName.test.tsx)')
  .action(async (componentPath: string, options: { 
    example?: string, 
    utils?: string[], 
    tests?: string[],
    interactive?: boolean,
    output?: string
  }) => {
    try {
      const generator = new AstTestGenerator();
      const result = await generator.generateTests(
        path.resolve(componentPath),
        {
          testUtilsPaths: options.utils?.map(p => path.resolve(p)),
          referenceTestsPaths: options.tests?.map(p => path.resolve(p)),
          outputPath: options.output ? path.resolve(options.output) : undefined
        }
      );
      console.log(`✅ Tests generated and saved to: ${result}`);

      if (options.interactive) {
        await startInteractiveMode(generator, result);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

async function startInteractiveMode(generator: AstTestGenerator, testFilePath: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔄 Interactive mode started');
  console.log('Type your feedback to improve the test (or "exit" to quit)');
  console.log('Example feedback: "Add tests for error handling" or "Add more test cases for form validation"');

  const askForFeedback = () => {
    rl.question('\n📝 Your feedback: ', async (feedback) => {
      if (feedback.toLowerCase() === 'exit') {
        console.log('👋 Goodbye!');
        rl.close();
        return;
      }

      try {
        const result = await generator.improveTest(testFilePath, feedback);
        console.log(`✅ Test improved and saved to: ${result}`);
        askForFeedback();
      } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
        askForFeedback();
      }
    });
  };

  askForFeedback();
}

program.parse();