import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './components/RequireAuth.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { WalletProvider } from './context/WalletContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PayoutPage from './pages/PayoutPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import WalletPage from './pages/WalletPage.jsx';

function ProtectedApplication() {
  return (
    <RequireAuth>
      <WalletProvider>
        <AppLayout />
      </WalletProvider>
    </RequireAuth>
  );
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedApplication />}>
          <Route path="/" element={<Navigate to="/wallet" replace />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/payout" element={<PayoutPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/wallet" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
