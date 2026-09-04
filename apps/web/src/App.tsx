import "./App.css";
import { useState } from "react";

import Dashboard from "./pages/dashboard";
import Payments from "./pages/payments";
import Transactions from "./pages/transactions";
import Recovery from "./pages/recovery";
import RazorpayCheckout from "./pages/RazorpayCheckout";
import Customers from "./pages/customers";
import Refunds from "./pages/refunds";
import Merchants from "./pages/merchants";

type Page =
  | "dashboard"
  | "payments"
  | "transactions"
  | "recovery"
  | "customers"
  | "refunds"
  | "merchants"
  | "razorpay";

export default function App() {
  const [activePage, setActivePage] =
    useState<Page>("dashboard");

  const renderPage = () => {
    switch (activePage) {
      case "payments":
        return <Payments />;

      case "razorpay":
        return <RazorpayCheckout />;

      case "transactions":
        return <Transactions />;

      case "recovery":
        return <Recovery />;

      case "customers":
        return <Customers />;

      case "refunds":
        return <Refunds />;

      case "merchants":
        return <Merchants />;

      case "dashboard":
      default:
        return <Dashboard />;
    }
  };

  const navItem = (
    page: Page,
    icon: string,
    label: string
  ) => (
    <button
      className={`nav-item ${
        activePage === page ? "active" : ""
      }`}
      onClick={() => setActivePage(page)}
    >
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="app">

      {/* SIDEBAR */}
      <aside className="sidebar">

        {/* LOGO */}
        <div className="sidebar-logo">
          <div className="logo-mark">R</div>

          <div>
            <div className="logo-name">
              RayFlow
            </div>

            <div className="logo-subtitle">
              Payments Infrastructure
            </div>
          </div>
        </div>

        {/* NAVIGATION */}
        <nav className="sidebar-nav">

          <div className="nav-section-title">
            OPERATIONS
          </div>

          {navItem(
            "dashboard",
            "D",
            "Dashboard"
          )}

          {navItem(
            "payments",
            "$",
            "Payments"
          )}

          {navItem(
            "razorpay",
            "₹",
            "Razorpay Checkout"
          )}

          {navItem(
            "transactions",
            "T",
            "Transactions"
          )}

          {navItem(
            "recovery",
            "R",
            "Recovery"
          )}

          <div className="nav-section-title">
            CUSTOMERS
          </div>

          {navItem(
            "customers",
            "C",
            "Customers"
          )}

          {navItem(
            "refunds",
            "F",
            "Refunds"
          )}

          {navItem(
            "merchants",
            "M",
            "Merchants"
          )}

        </nav>

        {/* SIDEBAR FOOTER */}
        <div className="sidebar-footer">

          <div className="system-status">
            <span className="status-dot"></span>

            <span>
              API Connected
            </span>
          </div>

          <div className="sidebar-version">
            RayFlow v1.0
          </div>

        </div>

      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">

        {/* TOP BAR */}
        <header className="topbar">

          <div className="topbar-left">

            <span className="topbar-title">
              RayFlow
            </span>

            <span className="topbar-separator">
              /
            </span>

            <span className="topbar-current">
              {activePage === "dashboard"
                ? "Dashboard"
                : activePage === "razorpay"
                  ? "Razorpay Checkout"
                  : activePage
                      .charAt(0)
                      .toUpperCase() +
                    activePage.slice(1)}
            </span>

          </div>

          <div className="topbar-right">

            <div className="environment-badge">
              <span className="status-dot"></span>
              Development
            </div>

            <div className="user-avatar">
              G
            </div>

          </div>

        </header>

        {/* PAGE */}
        <div className="page-content">
          {renderPage()}
        </div>

      </main>

    </div>
  );
}