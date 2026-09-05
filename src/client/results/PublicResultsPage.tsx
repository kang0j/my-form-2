import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { QuestionResult } from '../../server/aggregate'
import { apiGet } from '../api'
import { useDocumentTitle } from '../brand'
import { ResultsView } from './ResultsView'

type ResultsPayload = {
  title: string
  submissionCount: number
  results: QuestionResult[]
}

export function PublicResultsPage() {
  const { surveyId = '' } = useParams()
  const [payload, setPayload] = useState<ResultsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useDocumentTitle(payload?.title)

  useEffect(() => {
    apiGet<ResultsPayload>(`/api/surveys/${surveyId}/results`)
      .then(setPayload)
      .catch((e: Error) => setError(e.message))
  }, [surveyId])

  if (error) {
    return (
      <main>
        <h1>결과</h1>
        <p className="error">{error}</p>
      </main>
    )
  }

  if (!payload) {
    return (
      <main>
        <p>불러오고 있어요…</p>
      </main>
    )
  }

  return (
    <main>
      <h1>{payload.title}</h1>
      <ResultsView submissionCount={payload.submissionCount} results={payload.results} />
    </main>
  )
}
