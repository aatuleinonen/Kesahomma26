import { Authenticator } from '@aws-amplify/ui-react';

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="dashboard-container">
          <header className="dashboard-header">
            <div className="logo-container">
              <span className="logo-icon">💼</span>
              <span className="logo-text">PortfolioAdmin</span>
            </div>
            <div className="user-profile">
              <span className="user-email" title="Logged in as">
                {user?.signInDetails?.loginId || user?.username || "Authenticated User"}
              </span>
              <button className="sign-out-btn" onClick={signOut}>
                Sign Out
              </button>
            </div>
          </header>
          
          <main className="dashboard-content">
            <section className="welcome-banner">
              <span className="badge">System Online</span>
              <h1>Welcome to the Portfolio App</h1>
              <p>Manage projects, view traffic analytics, and customize your portfolio details.</p>
            </section>
            
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-icon">📁</span>
                <h3>Total Projects</h3>
                <div className="stat-value">12</div>
                <div className="stat-trend positive">↑ 4 new this month</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">👁️</span>
                <h3>Profile Views</h3>
                <div className="stat-value">1,248</div>
                <div className="stat-trend positive">↑ 12% vs last week</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">📨</span>
                <h3>Inquiries</h3>
                <div className="stat-value">7</div>
                <div className="stat-trend neutral">No new inquiries</div>
              </div>
            </div>
            
            <section className="quick-actions">
              <h2>Quick Actions</h2>
              <div className="actions-list">
                <button className="action-card" onClick={() => alert('Project creation coming soon!')}>
                  <span className="action-card-icon">➕</span>
                  <div className="action-card-text">
                    <h4>Add New Project</h4>
                    <p>Publish a new entry to your portfolio site.</p>
                  </div>
                </button>
                <button className="action-card" onClick={() => alert('Analytics dashboard coming soon!')}>
                  <span className="action-card-icon">📊</span>
                  <div className="action-card-text">
                    <h4>View Analytics</h4>
                    <p>Track visitor engagement and referrers.</p>
                  </div>
                </button>
                <button className="action-card" onClick={() => alert('Settings configuration coming soon!')}>
                  <span className="action-card-icon">⚙️</span>
                  <div className="action-card-text">
                    <h4>Settings</h4>
                    <p>Configure Cognito details and API keys.</p>
                  </div>
                </button>
              </div>
            </section>
          </main>
          
          <footer className="dashboard-footer">
            <p>&copy; 2026 Portfolio App. All rights reserved.</p>
          </footer>
        </div>
      )}
    </Authenticator>
  );
}

export default App;
