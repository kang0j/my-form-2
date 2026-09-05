import { Route, Routes } from 'react-router-dom'
import { AdminApp } from './admin/AdminApp'
import { SITE_NAME } from './brand'
import { HomePage } from './HomePage'
import { PublicResultsPage } from './results/PublicResultsPage'
import { VoteFlow } from './vote/VoteFlow'

function NotFound() {
  return (
    <main>
      <h1>{SITE_NAME}</h1>
      <p>페이지를 찾지 못했어요.</p>
    </main>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/s/:surveyId" element={<VoteFlow />} />
      <Route path="/s/:surveyId/results" element={<PublicResultsPage />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
