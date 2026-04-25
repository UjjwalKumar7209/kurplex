import express from 'express'
import { tavily } from '@tavily/core'
import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from './prompt'
import cors from 'cors'
import { middleware } from './middleware'
import { prisma } from './db'

const client = tavily({ apiKey: process.env.TAVILY_API_KEY })
const app = express()

app.use(express.json())
app.use(cors())

// Get all past conversations for a user
app.get('/conversation', middleware, async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        userId: req.userId
      },
      orderBy: {
        id: 'desc'
      }
    })
    res.json(conversations)
  } catch (error) {
    console.error('Error fetching conversations:', error)
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

// Get a specific conversation with all its messages
app.get('/conversation/:conversationId', middleware, async (req, res) => {
  try {
    const { conversationId } = req.params
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    })

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (conversation.userId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    res.json(conversation)
  } catch (error) {
    console.error('Error fetching conversation:', error)
    res.status(500).json({ error: 'Failed to fetch conversation' })
  }
})

app.post('/kurplex_ask', middleware, async (req, res) => {
  // Step 1 get the query from the user
  const query = req.body.query

  // Step 2 (TO BE DONE LATER) make sure user has access/credits to hit the endpoint

  // Step 3 (TO BE DONE LATER) check if we have web search indexed for a similar query

  // Step 4 web search to gather sources
  const webSearchResponse = await client.search(query, {
    searchDepth: 'advanced'
  })
  const webSearchResult = webSearchResponse.results

  // Step 5 do some context engineering on the prompt + web search responses

  // Step 6 the the LLM and stream back the response
  // hit the LLM? llm api/openrouter/vercel ai gateway
  const prompt = PROMPT_TEMPLATE.replace(
    '{{WEB_SEARCH_RESULTS}}',
    JSON.stringify(webSearchResult)
  ).replace('{{USER_QUERY}}', query)

  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
  })

  const result = streamText({
    model: openrouter('meta-llama/llama-3-8b-instruct'),
    prompt: prompt,
    system: SYSTEM_PROMPT
  })

  for await (const textPart of result.textStream) {
    res.write(textPart)
  }

  res.write('\n<SOURCES>\n')
  // Step 7 also stream back tha sources and the follow up questions which we can get from the other parallel LLM call
  res.write(
    JSON.stringify(webSearchResult.map((result) => ({ url: result.url })))
  )

  res.write('\n</SOURCES>\n')
  // Step 8 Close the event stream
  res.end()

  // Step 9 Save the conversation and messages to database
  try {
    const conversation = await prisma.conversation.create({
      data: {
        userId: req.userId,
        title: query.substring(0, 50),
        slug: query
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .substring(0, 50),
        messages: {
          create: [
            {
              content: query,
              role: 'User'
            },
            {
              content: (result.textStream as any).toString(), // The streamed LLM response
              role: 'Assistant'
            }
          ]
        }
      }
    })
  } catch (error) {
    console.error('Error saving conversation:', error)
  }
})

app.post('/kurples_ask/follow_ups', middleware, async (req, res) => {
  try {
    // Step 1 - get the existing chat from the db
    const { conversationId } = req.body
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (conversation.userId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    // Step 2 - Forward the full history to the LLM
    const chatHistory = conversation.messages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n')

    const followUpPrompt = `Based on the following conversation, generate 3 follow-up questions that would help the user explore this topic further. Return ONLY the questions, one per line.\n\n${chatHistory}`

    const openrouter = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY
    })

    // Step 3 - Stream the response to the user
    const result = streamText({
      model: openrouter('meta-llama/llama-3-8b-instruct'),
      prompt: followUpPrompt
    })

    for await (const textPart of result.textStream) {
      res.write(textPart)
    }

    res.end()
  } catch (error) {
    console.error('Error generating follow-ups:', error)
    res.status(500).json({ error: 'Failed to generate follow-up questions' })
  }
})

app.listen(3001)
