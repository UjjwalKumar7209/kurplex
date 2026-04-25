import { createClient } from '@/lib/client'
import type { User } from '@supabase/supabase-js'
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router'
import { BACKEND_URL } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  LogOut,
  Plus,
  Send,
  Loader,
  ExternalLink,
  Link as LinkIcon
} from 'lucide-react'

const supabase = createClient()

interface Message {
  id: number
  content: string
  role: 'User' | 'Assistant'
  createdAt: string
}

interface Conversation {
  id: string
  title: string | null
  slug: string
  userId: string
  messages?: Message[]
}

// Parse markdown-like formatting
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n')

  return (
    <div className="space-y-4 text-[15px] leading-7 text-zinc-300">
      {lines.map((line, idx) => {
        // Bold text
        let content = line.replace(
          /\*\*(.*?)\*\*/g,
          (_, text) => `<strong class="text-zinc-100 font-semibold">${text}</strong>`
        )
        // Italic text
        content = content.replace(/\*(.*?)\*/g, (_, text) => `<em>${text}</em>`)

        if (line.startsWith('- ')) {
          return (
            <div key={idx} className="flex gap-3 ml-1 mt-2">
              <span className="text-zinc-500 select-none">•</span>
              <div
                dangerouslySetInnerHTML={{ __html: content.replace('- ', '') }}
                className="flex-1"
              />
            </div>
          )
        } else if (line.startsWith('# ')) {
          return (
            <h1 key={idx} className="text-2xl font-semibold text-zinc-100 mt-6 mb-4 tracking-tight">
              {content.replace('# ', '')}
            </h1>
          )
        } else if (line.startsWith('## ')) {
          return (
            <h2 key={idx} className="text-xl font-medium text-zinc-100 mt-5 mb-3 tracking-tight">
              {content.replace('## ', '')}
            </h2>
          )
        } else if (line.trim()) {
          return (
            <p
              key={idx}
              dangerouslySetInnerHTML={{ __html: content }}
              className="leading-7"
            />
          )
        }
        return null
      })}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] =
    useState<Conversation | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [response, setResponse] = useState('')
  const [sources, setSources] = useState<Array<{ url: string }>>([
    {
      url: ''
    }
  ])
  const [followUps, setFollowUps] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, response])

  useEffect(() => {
    async function getInfo() {
      const { data, error } = await supabase.auth.getUser()
      if (data.user) {
        setUser(data.user)
      } else {
        navigate('/auth')
      }
    }
    getInfo()
  }, [])

  useEffect(() => {
    async function getExistingConversations() {
      if (user) {
        const {
          data: { session }
        } = await supabase.auth.getSession()
        const jwt = session?.access_token
        try {
          const response = await fetch(`${BACKEND_URL}/conversation`, {
            headers: {
              Authorization: jwt || ''
            }
          })
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`)
          const data = await response.json()
          setConversations(data)
        } catch (error) {
          console.error('Error fetching conversations:', error)
        }
      }
    }
    getExistingConversations()
  }, [user])

  useEffect(() => {
    async function getConversationMessages() {
      if (currentConversation) {
        const {
          data: { session }
        } = await supabase.auth.getSession()
        const jwt = session?.access_token
        try {
          const response = await fetch(
            `${BACKEND_URL}/conversation/${currentConversation.id}`,
            {
              headers: {
                Authorization: jwt || ''
              }
            }
          )
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`)
          const data = await response.json()
          setMessages(data.messages || [])
          setResponse('')
          setSources([])
          setFollowUps([])
        } catch (error) {
          console.error('Error fetching conversation:', error)
        }
      }
    }
    getConversationMessages()
  }, [currentConversation])

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim() || loading) return

    const currentMessages = [...messages]
    if (response) {
      currentMessages.push({
        id: Date.now(),
        content: response,
        role: 'Assistant',
        createdAt: new Date().toISOString()
      })
    }

    setLoading(true)
    setResponse('')
    setSources([])
    setFollowUps([])
    setMessages([
      ...currentMessages,
      {
        id: Date.now() + 1,
        content: query,
        role: 'User',
        createdAt: new Date().toISOString()
      }
    ])

    const {
      data: { session }
    } = await supabase.auth.getSession()
    const jwt = session?.access_token

    try {
      const response = await fetch(`${BACKEND_URL}/kurplex_ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: jwt || ''
        },
        body: JSON.stringify({ query })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let fullText = ''

      // Read entire stream
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        fullText += text
      }

      // Parse the complete response
      const answerMatch = fullText.match(/<ANSWER>([\s\S]*?)<\/ANSWER>/)
      const answerText = answerMatch
        ? answerMatch[1].trim()
        : fullText.split('<SOURCES>')[0]

      const followUpsMatch = fullText.match(
        /<FOLLOW_UPS>([\s\S]*?)<\/FOLLOW_UPS>/
      )
      let followUpsList: string[] = []
      if (followUpsMatch) {
        const followUpsText = followUpsMatch[1]
        const questionMatches = followUpsText.match(
          /<question>(.*?)<\/question>/g
        )
        if (questionMatches) {
          followUpsList = questionMatches.map((q) =>
            q.replace(/<\/?question>/g, '').trim()
          )
        }
      }

      const sourcesMatch = fullText.match(/<SOURCES>([\s\S]*?)<\/SOURCES>/)
      let sourcesList: Array<{ url: string }> = []
      if (sourcesMatch) {
        try {
          const sourcesText = sourcesMatch[1].trim()
          sourcesList = JSON.parse(sourcesText).filter((s: any) => s.url)
        } catch (e) {
          console.error('Error parsing sources:', e)
        }
      }

      setResponse(answerText)
      setSources(sourcesList)
      setFollowUps(followUpsList)
      setLoading(false)
      setQuery('')
    } catch (error) {
      console.error('Error:', error)
      setLoading(false)
      setResponse('Error: Failed to get response. Please try again.')
    }
  }

  async function handleFollowUp(followUpQuestion: string) {
    setQuery(followUpQuestion)
    // Auto-submit after a small delay
    setTimeout(() => {
      const form = document.querySelector('form') as HTMLFormElement
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }))
    }, 100)
  }

  async function handleNewChat() {
    setCurrentConversation(null)
    setMessages([])
    setResponse('')
    setSources([])
    setFollowUps([])
    setQuery('')
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setUser(null)
    navigate('/auth')
  }

  return (
    <div className="dark h-screen bg-[#0f0f0f] flex text-zinc-100 overflow-hidden font-sans selection:bg-blue-500/30">
      {/* Sidebar */}
      <div className="w-64 bg-[#141414] border-r border-white/5 flex flex-col h-screen shrink-0 hidden md:flex">
        {/* Header */}
        <div className="p-4">
          <Button
            onClick={handleNewChat}
            variant="outline"
            className="w-full bg-transparent border-white/10 hover:border-white/20 hover:bg-white/5 text-zinc-200 justify-start gap-3 rounded-xl h-10 px-4 transition-all duration-200"
          >
            <Plus className="h-4 w-4" />
            <span className="font-medium text-sm">New Thread</span>
          </Button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto space-y-1 p-3">
          <div className="text-xs font-medium text-zinc-500 px-2 pb-2 uppercase tracking-wider">Recent</div>
          {conversations.length === 0 ? (
            <div className="p-2 text-zinc-600 text-sm">
              No history
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setCurrentConversation(conv)}
                className={`px-3 py-2 rounded-lg cursor-pointer truncate text-sm transition-all duration-200 ${
                  currentConversation?.id === conv.id
                    ? 'bg-white/10 text-zinc-100 font-medium'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`}
              >
                {conv.title || 'Untitled'}
              </div>
            ))
          )}
        </div>

        {/* User Profile */}
        <div className="p-4 border-t border-white/5">
          {user && (
            <div className="flex items-center gap-3 w-full">
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center text-xs font-medium text-white shadow-sm shrink-0">
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200 truncate">{user.email}</div>
                <button onClick={handleSignOut} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Sign out</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-[#0f0f0f] relative">
        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth pb-40">
          <div className="max-w-3xl mx-auto w-full">
            {messages.length === 0 && !response && (
              <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <div className="text-4xl md:text-5xl font-semibold text-zinc-100 tracking-tight">
                    Where knowledge begins
                  </div>
                  <p className="text-zinc-400 text-base md:text-lg">
                    Ask anything, get verified answers.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-8 mt-4">
              {messages.map((msg) => (
                <div key={msg.id} className="animate-in fade-in duration-300">
                  {msg.role === 'User' ? (
                    <div className="flex justify-end">
                      <div className="bg-[#1c1c1c] text-zinc-200 px-5 py-3.5 rounded-3xl rounded-br-md max-w-[85%] text-[15px] leading-relaxed font-light shadow-sm border border-white/5">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="w-full">
                        <MarkdownText text={msg.content} />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {response && (
                <div className="flex justify-start animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="w-full">
                    <MarkdownText text={response} />

                    {sources.length > 0 && (
                      <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                          <LinkIcon className="h-4 w-4 text-blue-400" />
                          <span>Sources</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {sources.map((source, idx) => {
                            try {
                              const url = new URL(source.url)
                              const domain = url.hostname.replace('www.', '')
                              return (
                                <a
                                  key={idx}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1c1c1c] border border-white/5 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all duration-200"
                                >
                                  <span className="text-xs text-zinc-400 group-hover:text-blue-400 truncate max-w-[150px]">
                                    {domain}
                                  </span>
                                </a>
                              )
                            } catch {
                              return null
                            }
                          })}
                        </div>
                      </div>
                    )}

                    {followUps.length > 0 && (
                      <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                          <span className="text-blue-400">✧</span>
                          <span>Related Questions</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {followUps.map((fq, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleFollowUp(fq)}
                              className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1c1c1c] border border-white/5 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all duration-200 text-left w-full sm:w-fit"
                            >
                              <Plus className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 shrink-0" />
                              <span className="text-sm text-zinc-300 group-hover:text-zinc-100 font-light">
                                {fq}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {loading && !response && (
                <div className="flex justify-start animate-in fade-in duration-300">
                  <div className="flex items-center gap-3 text-zinc-400">
                    <Loader className="h-5 w-5 animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Analyzing...</span>
                  </div>
                </div>
              )}
            </div>
            
            <div ref={messagesEndRef} className="h-8" />
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f] to-transparent z-10 pointer-events-none">
          <form onSubmit={handleAsk} className="max-w-3xl mx-auto pointer-events-auto">
            <div className="relative flex items-center bg-[#1c1c1c] backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.5)] focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/40 transition-all duration-300">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask anything..."
                disabled={loading}
                className="flex-1 bg-transparent border-none text-zinc-100 placeholder:text-zinc-500 shadow-none focus-visible:ring-0 px-5 py-4 h-auto text-[15px] font-light"
              />
              <Button
                type="submit"
                disabled={loading || !query.trim()}
                size="icon"
                className="absolute right-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl h-10 w-10 transition-all duration-200 disabled:opacity-30 disabled:bg-white/10 shadow-sm"
              >
                {loading ? (
                  <Loader className="h-4 w-4 animate-spin text-zinc-300" />
                ) : (
                  <Send className="h-4 w-4 ml-0.5" />
                )}
              </Button>
            </div>
            <div className="text-center mt-3 text-[11px] text-zinc-500 font-light hidden md:block">
              Kurplex AI can make mistakes. Verify important information.
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
