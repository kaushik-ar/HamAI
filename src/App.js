import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import AuthContextProvider from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Register from './pages/Register';
import CompleteProfile from './pages/CompleteProfile';
import Dashboard from './pages/Dashboard';
import AddEntry from './pages/AddEntry';
import BatchEntry from './pages/BatchEntry';
import ReviewEntry from './pages/ReviewEntry';
import Profile from './pages/Profile';
import { setNavigate } from './utils/navigation';
import './App.css';

function AppRoutes() {
  const navigate = useNavigate();
  
  // Set global navigate function for AuthContext to use
  React.useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/complete-profile"
              element={
                <PrivateRoute>
                  <CompleteProfile />
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <Dashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/add-entry"
              element={
                <PrivateRoute>
                  <AddEntry />
                </PrivateRoute>
              }
            />
            <Route
              path="/batch-entry"
              element={
                <PrivateRoute>
                  <BatchEntry />
                </PrivateRoute>
              }
            />
            <Route
              path="/review-entry"
              element={
                <PrivateRoute>
                  <ReviewEntry />
                </PrivateRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <PrivateRoute>
                  <Profile />
                </PrivateRoute>
              }
            />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthContextProvider>
        <Router>
          <div className="App">
            <Toaster position="top-right" />
            <AppRoutes />
          </div>
        </Router>
      </AuthContextProvider>
    </ErrorBoundary>
  );
}

export default App;
