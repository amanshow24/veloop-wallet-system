import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/wallet" aria-label="VELoop Rewards home">
          <span className="brand-mark brand-mark-small" aria-hidden="true">V</span>
          <span>VELoop <span className="brand-light">Rewards</span></span>
        </NavLink>
        <nav aria-label="Main navigation">
          <NavLink to="/wallet" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Wallet
          </NavLink>
          <NavLink to="/payout" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Payout
          </NavLink>
        </nav>
        <div className="user-menu">
          <span className="user-name">{user?.name}</span>
          <button className="sign-out-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
