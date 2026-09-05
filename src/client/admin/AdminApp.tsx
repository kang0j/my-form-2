import { Route, Routes } from 'react-router-dom'
import { SurveyDetail } from './SurveyDetail'
import { SurveyList } from './SurveyList'

export function AdminApp() {
  return (
    <Routes>
      <Route index element={<SurveyList />} />
      <Route path="surveys/:surveyId" element={<SurveyDetail />} />
    </Routes>
  )
}
