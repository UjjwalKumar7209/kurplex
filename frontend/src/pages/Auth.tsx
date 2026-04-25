import { createClient } from "@/lib/client"

const supabase = createClient()

export default function Auth() {
  async function login(provider: 'github' | 'google') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider
    })
    if (error) {
        alert("Error while signing in")
    } else {
        alert("Signed in")
    }
  }
  return (
    <div>
      <button onClick={() => login('google')}>Login with google</button>
      <button onClick={() => login('github')}>Login with github</button>
    </div>
  )
}
