const getAnalysisPrompt = (
  fileName: string,
  entryCode: string,
  dependenciesCode: string[],
  testUtils?: string[],
  referenceTests?: string[]
) => `
Analyze the component and generate a test structure.

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

${testUtils ? `Test utilities:
\`\`\`typescript
${testUtils.join("\n\n")}
\`\`\`
` : ""}

${referenceTests ? `Reference tests:
\`\`\`typescript
${referenceTests.join("\n\n")}
\`\`\`
` : ""}

Requirements:
1. Analyze the component's functionality
2. Identify all user interactions
3. List all API endpoints used
4. Identify form fields and validations
5. List all edge cases to test
6. Use test utilities and follow patterns from reference tests if provided

Output a structured plan for testing in the following format:
1. Test Suites (describe blocks)
2. Test Cases (it blocks)
3. Required Mocks
4. Test Data
5. Edge Cases

Output ONLY the test plan without explanations.
`

const implementationPromptText = `
Generate test implementation based on the test plan.

Requirements:
1. Use MSW version 2 for API mocking
2. Use data-testid attributes
3. Test accessibility
4. Verify component state changes
5. Check side effects
6. Don't test aria-attributes
7. Use provided test utilities
8. Follow patterns from reference tests
9. When use render method. Render <App /> component

Generate the test implementation following the plan.
Output ONLY the test code without explanations.
`

const mswSystemPromptText = `
You expert on msw mocking library.

Bad mocking example:
\`\`\`typescript
  const server = setupServer(
    rest.get('https://jsonplaceholder.typicode.com/todos?_limit=10', (req, res, ctx) => {
      return res(ctx.json([{ id: 1, title: 'Task 1', completed: false }, { id: 2, title: 'Task 2', completed: true }, { id: 3, title: 'Task 3', completed: false }]))
    })
  )

  // bad use request to get data example
  http.post('https://jsonplaceholder.typicode.com/todos', (request) => {
    const body = JSON.parse(request.body);
    return HttpResponse.json({ id: 4, text: body.title, completed: false });
  })

  // bad get params example
  http.put('https://jsonplaceholder.typicode.com/todos/:id', (request) => {
    const params = request.params;
    const body = JSON.parse(request.body);
    return HttpResponse.json({
      id: parseInt(params.id),
      text: body.title,
      completed: body.completed,
    });
  })

  // bad get empty data example
  http.delete('https://jsonplaceholder.typicode.com/todos/:id', () => {
    return HttpResponse.empty();
  })
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
      )
    );

    // network error
    http.get('https://jsonplaceholder.typicode.com/todos?_limit=10', () =>
      HttpResponse.error()
    );

    // use request to get data
    http.get('https://jsonplaceholder.typicode.com/todos?_limit=10', async ({ request }) => {
      const data = await request.clone().json();

      if (data?.id === 'abc-123') {
        return HttpResponse.json({ id: 'abc-123' })
      }

      return HttpResponse.json({ id: 'not-found' })
    });

    // good get params example
    http.put('https://jsonplaceholder.typicode.com/todos/:id', async ({ request, params }) => {
      const { id } = params;
      const body = await request.clone().json();
      return HttpResponse.json({
        id,
        text: body.title,
        completed: body.completed,
      });
    });

    // good get empty data example
    http.delete('https://jsonplaceholder.typicode.com/todos/:id', () => {
      return HttpResponse.json();
    }),
  ];

  setupServer(...handlers)
\`\`\`

Do not use 'rest' method. Only http and HttpResponse.
`

const getMswPromptText = (testCode: string) => `
Tests with msw handlers that you need improve: ${testCode}

Requirements:
1. Use http and HttpResponse from msw
2. Handle success responses
3. Handle error responses
4. Handle network errors
5. Handle request parameters
6. Handle request body
7. Don not use 'res()' method

Output improved msw mocks with all tests from prompt. Output ONLY code without explanation
`

const reviewPromptText = `
Review and improve the test.

Requirements:
1. Ensure all test cases from the plan are implemented
2. Verify all user interactions are tested
3. Check all edge cases are covered
4. Ensure proper error handling
5. Verify loading states
6. Check data persistence
7. Verify component state changes
8. Ensure clean and organized code

Make any necessary improvements.
Output ONLY the final test code without explanations.
`

const systemPromptText = `You are a senior QA engineer on Typescript. You use Vitest + React Testing Library + MSW for testing. You use data-testid attributes for testing. You test accessibility. You test component state changes. You check side effects. You don't test aria-attributes. You use MSW for API mocking.`

export { getAnalysisPrompt, implementationPromptText, reviewPromptText, systemPromptText, mswSystemPromptText, getMswPromptText }