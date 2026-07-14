import axios from 'axios'
import { BACKEND_URL } from './constants'
import { supabase } from './supabase'

export async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again')
  return { Authorization: `Bearer ${token}` }
}

export async function apiGet(path, config = {}) {
  const headers = await authHeaders()
  return axios.get(`${BACKEND_URL}${path}`, {
    ...config,
    headers: { ...headers, ...(config.headers || {}) }
  })
}

export async function apiPost(path, body = {}, config = {}) {
  const headers = await authHeaders()
  return axios.post(`${BACKEND_URL}${path}`, body, {
    ...config,
    headers: { ...headers, ...(config.headers || {}) }
  })
}

export async function apiPut(path, body = {}, config = {}) {
  const headers = await authHeaders()
  return axios.put(`${BACKEND_URL}${path}`, body, {
    ...config,
    headers: { ...headers, ...(config.headers || {}) }
  })
}

