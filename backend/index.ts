import express from 'express'
import { tavily } from '@tavily/core'
import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from './prompt'
import cors from "cors"
import { middleware } from './middleware'

const client = tavily({ apiKey: process.env.TAVILY_API_KEY })
const app = express()

app.use(express.json())
app.use(cors())

// Past conversatins get
app.get("/conversation", middleware, async (req, res) => {
    res.json({
        userId: req.userId
    })
})

// Past conversatins get
app.get("/conversation/:conversationId", middleware, async (req, res) => {

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
})

app.post("/kurples_ask/follow_ups", middleware, async (req, res) => {
    // Step 1 - get the existing chat from the db
    // Step 2 - Forward the full history to the LLM
    // Step 3 - Stream the response to the user
})

app.listen(3001)
