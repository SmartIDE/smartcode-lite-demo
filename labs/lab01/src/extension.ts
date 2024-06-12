import { WriteStream } from 'fs';
import * as vscode from 'vscode';
import * as fs from 'fs';

import {
    encode,
    encodeChat,
    decode,
    isWithinTokenLimit,
    encodeGenerator,
    decodeGenerator,
    decodeAsyncGenerator,
  } from 'gpt-tokenizer'

const SMARTCODE_PARTICIPANT_ID = 'demo.smartcode-lite';
const TOKEN_LIMIT_GPT35_TURBO = 4096;

interface ISmartCodeChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
}

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-3.5-turbo' };

let sql_context = '';

export function activate(context: vscode.ExtensionContext) {

    // Define a GitHub Copilot Chat handler that will be called when the user interacts with the SmartCode
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest, 
        context: vscode.ChatContext, 
        stream: vscode.ChatResponseStream, 
        token: vscode.CancellationToken): Promise<ISmartCodeChatResult> => {
        // To talk to an LLM in your subcommand handler implementation, your
        // extension can use VS Code's `requestChatAccess` API to access the Copilot API.
        // The GitHub Copilot Chat extension implements this provider.

        if (sql_context.length == 0) {
            stream.markdown('Please open provide your database context first.');
            return { metadata: { command: '' } };
        }

        let messages: vscode.LanguageModelChatMessage[] = [];

        stream.progress('SmartCode is thinking ...');
        messages = [
            vscode.LanguageModelChatMessage.User(await generateSystemPrompt(request.command)),
            vscode.LanguageModelChatMessage.User(await generateUserPrompt(request.prompt, await getDatabaseContext1(sql_context)))
        ];

        const messages_tokens = encode(messages.map(m => m.content).join('\n'));

        if (messages_tokens.length > TOKEN_LIMIT_GPT35_TURBO) {
            stream.markdown('The input is too large for the SmartCode to process.');
            return { metadata: { command: '' } };
        }      

        const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
        const chatResponse = await model.sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
            // Process the output from the language model
            stream.markdown(fragment);                
        }

        return { metadata: { command: '' } };
    };

    // Chat participants appear as top-level options in the chat input
    // when you type `@`, and can contribute sub-commands in the chat input
    // that appear when you type `/`.
    const smartcode_handler = vscode.chat.createChatParticipant(SMARTCODE_PARTICIPANT_ID, handler);
    smartcode_handler.iconPath = vscode.Uri.joinPath(context.extensionUri, 'smartcode_logo.png');
    smartcode_handler.followupProvider = {
        provideFollowups(result: ISmartCodeChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) {
            return [{
                prompt: 'how can I do better job based on the answer above?',
                label: vscode.l10n.t('如何改进这些代码？'),
                //command: ''
            } satisfies vscode.ChatFollowup,
            {
                prompt: 'how can I do better job based on the answer above?',
                label: vscode.l10n.t('如何生成数据库实体类？'),
                //command: ''
            } satisfies vscode.ChatFollowup];
        }
    };

    let disposable: vscode.Disposable = vscode.commands.registerCommand('SmartCode.readFile', () => {
        const filePath = vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Open',
            filters: {
                'SQL files': ['sql'],
                'All files': ['*']
            }
        });

        sql_context = '';

        filePath.then(fileUri => {
            if (fileUri && fileUri[0]) {
                fs.readFile(fileUri[0].fsPath, 'utf8', (err, data) => {
                    if (err) {
                        vscode.window.showErrorMessage('Failed to read file');
                    } else {
                        sql_context = data;
                        const tokens = encode(data);
                        console.log("read file content with " + sql_context.length + " characters and " + tokens.length + " tokens.");
                        if (tokens.length > TOKEN_LIMIT_GPT35_TURBO) {
                            vscode.window.showErrorMessage(
                                'The file content is too large for the SmartCode to process.\n' +
                                'Current file is taking ' + tokens.length + ' tokens, \n' +
                                'while the limit is ' + TOKEN_LIMIT_GPT35_TURBO + ' tokens.');
                            sql_context = '';
                        }
                        //vscode.window.showInformationMessage('File content: ' + data);
                    }
                });
            }
        });
    });

    context.subscriptions.push(disposable);


}

// Get a random topic that the SmartCode has not taught in the chat history yet
function getTopic(history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>): string {
    const topics = ['linked list', 'recursion', 'stack', 'queue', 'pointers'];
    // Filter the chat history to get only the responses from the SmartCode
    const previousSmartCodeResponses = history.filter(h => {
        return h instanceof vscode.ChatResponseTurn && h.participant == SMARTCODE_PARTICIPANT_ID
    }) as vscode.ChatResponseTurn[];
    // Filter the topics to get only the topics that have not been taught by the SmartCode yet
    const topicsNoRepetition = topics.filter(topic => {
        return !previousSmartCodeResponses.some(SmartCodeResponse => {
            return SmartCodeResponse.response.some(r => {
                return r instanceof vscode.ChatResponseMarkdownPart && r.value.value.includes(topic)
            });
        });
    });

    return topicsNoRepetition[Math.floor(Math.random() * topicsNoRepetition.length)] || 'I have taught you everything I know. Meow!';
}

export function deactivate() { }

async function generateSystemPrompt(command:string|undefined): Promise<string>{
    if (command == 'query') {
        return `
        You are a world class software developer! Think carefully and step by step like a professional developer would.
        Your job is to help the user write readable and performant SQL queries.
        Please reponse with explaination of the query first, then provide the SQL query in a markdown code block.
        Please always response in Chinese.`;
    }else if (command == 'schema') {
        return `
        You are a world class software developer! Think carefully and step by step like a professional developer would.
        Please answer the [User query] based on the given [Database context] only, if the context is not provided, please ask the user to provide it first.
        Please always response in Chinese.`;
    }else if (command == 'docs'){
        return `
        You are a world class software developer! Think carefully and step by step like a professional developer would.
        Please generate markdown documentation for the SQL table mentioned in [User query] based on give [Database context].
        Please use markdown table to show the table columns' name, data types, constraints and comments.
        Please always response in Chinese.`;
    }
    else{
        return `
        You are a world class software developer! Think carefully and step by step like a professional developer would.
        Please always response in Chinese.`;
    }
   
}

async function generateUserPrompt(userQuery: string, dbContext: string|undefined): Promise<string>{
	return `
        [User query]: ${userQuery}
        [Database context]: ${dbContext}
        `;
}

export async function getDatabaseContext1(sql: string) {

	// if sql is not empty, then use the sql, otherwise use the arr below
	if (sql.length > 0) {
		return sql;
	}

	var arr = []
	var a = `SET ANSI_NULLS ON
	 GO
	 SET QUOTED_IDENTIFIER ON
	 GO
	 CREATE TABLE [dbo].[Courses](
		 [CourseID] [int] NOT NULL,
		 [CourseName] [varchar](50) NOT NULL,
	 PRIMARY KEY CLUSTERED 
	 (
		 [CourseID] ASC
	 )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
	 ) ON [PRIMARY]
	 GO`

	var b = `SET ANSI_NULLS ON
	 GO
	 SET QUOTED_IDENTIFIER ON
	 GO
	 CREATE TABLE [dbo].[Modules](
		 [ModuleCode] [varchar](5) NOT NULL,
		 [ModuleTitle] [varchar](50) NOT NULL,
	 PRIMARY KEY CLUSTERED 
	 (
		 [ModuleCode] ASC
	 )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
	 ) ON [PRIMARY]
	 GO
	 `
	var c = `SET ANSI_NULLS ON
	 GO
	 SET QUOTED_IDENTIFIER ON
	 GO
	 CREATE TABLE [dbo].[StudyPlans](
		 [CourseID] [int] NOT NULL,
		 [ModuleCode] [varchar](5) NOT NULL,
		 [ModuleSequence] [int] NOT NULL,
	 PRIMARY KEY CLUSTERED 
	 (
		 [CourseID] ASC,
		 [ModuleCode] ASC
	 )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
	 ) ON [PRIMARY]
	 GO
	 `
	arr.push(a);
	arr.push(b);
	arr.push(c);
	return arr.join('\n')
}