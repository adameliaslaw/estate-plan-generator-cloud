/**
 * ErrorBoundary.tsx
 *
 * React class component error boundary.
 * Catches rendering errors anywhere in the component tree and displays a
 * branded, user-friendly error screen rather than a blank page.
 *
 * Usage:
 *   Wrap <Routes> (inside BrowserRouter, outside Suspense) so that route
 *   rendering errors are caught application-wide.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/constants';

const isProduction = import.meta.env.PROD;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render shows the fallback UI
    return {
      hasError: true,
      errorMessage: isProduction ? null : error.message,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log full details to console — never expose to the user in production
    console.error('[ErrorBoundary] Uncaught rendering error:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f7fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            padding: '2.5rem',
            textAlign: 'center',
          }}
        >
          {/* Firm branding */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: '#1a365d',
              marginBottom: '1.25rem',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="28"
              height="28"
            >
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>

          <p
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#1a365d',
              marginBottom: '0.5rem',
            }}
          >
            Elias Counsel, LLC
          </p>

          <h1
            style={{
              fontSize: '1.375rem',
              fontWeight: 700,
              color: '#1a2744',
              marginBottom: '0.75rem',
              lineHeight: 1.3,
            }}
          >
            Something went wrong
          </h1>

          <p
            style={{
              fontSize: '0.9rem',
              color: '#718096',
              lineHeight: 1.6,
              marginBottom: '1.75rem',
            }}
          >
            An unexpected error occurred while loading this page. Your data is safe. Please reload
            the page or return to the dashboard.
          </p>

          {/* Dev-only error details — never shown in production */}
          {!isProduction && this.state.errorMessage && (
            <div
              style={{
                backgroundColor: '#fff5f5',
                border: '1px solid #fed7d7',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                marginBottom: '1.5rem',
                textAlign: 'left',
              }}
            >
              <p
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#c53030',
                  marginBottom: '0.25rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Dev — Error Details
              </p>
              <code
                style={{
                  fontSize: '0.78rem',
                  color: '#9b2c2c',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {this.state.errorMessage}
              </code>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              onClick={this.handleReload}
              style={{
                backgroundColor: '#1a365d',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.6rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseOver={(e) => ((e.target as HTMLButtonElement).style.backgroundColor = '#2b6cb0')}
              onMouseOut={(e) => ((e.target as HTMLButtonElement).style.backgroundColor = '#1a365d')}
            >
              Reload Page
            </button>

            <Link
              to={ROUTES.DASHBOARD}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                backgroundColor: '#ffffff',
                color: '#1a365d',
                border: '1px solid #bee3f8',
                borderRadius: '8px',
                padding: '0.6rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'background-color 0.15s',
              }}
              onMouseOver={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#ebf8ff')
              }
              onMouseOut={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#ffffff')
              }
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
