"use client";

import { useState, useEffect, useCallback } from "react";

function getMonthStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateHeader(dateStr) {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

export default function CalendarSidebar() {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(() => ({
    year: today.getUTCFullYear(),
    month: today.getUTCMonth() + 1,
  }));
  const [calendarData, setCalendarData] = useState({ days: {}, totals: {} });
  const [selectedDate, setSelectedDate] = useState(null);
  const [loading, setLoading] = useState(false);

  const monthStr = `${currentMonth.year}-${String(currentMonth.month).padStart(2, "0")}`;

  const fetchCalendar = useCallback(async (ms) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/applications/calendar?month=${ms}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarData({ days: data.days || {}, totals: data.totals || {} });
      }
    } catch {
      // Silently fail — calendar is supplementary
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendar(monthStr);
    setSelectedDate(null);
  }, [monthStr, fetchCalendar]);

  function prevMonth() {
    setCurrentMonth((prev) => {
      if (prev.month === 1) return { year: prev.year - 1, month: 12 };
      return { ...prev, month: prev.month - 1 };
    });
  }

  function nextMonth() {
    setCurrentMonth((prev) => {
      if (prev.month === 12) return { year: prev.year + 1, month: 1 };
      return { ...prev, month: prev.month + 1 };
    });
  }

  const daysInMonth = getDaysInMonth(currentMonth.year, currentMonth.month);
  const firstDay = getFirstDayOfWeek(currentMonth.year, currentMonth.month);
  const monthLabel = new Date(currentMonth.year, currentMonth.month - 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;

  // Build day cells
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthStr}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, dateStr, count: calendarData.totals[dateStr] || 0 });
  }

  const selectedJobs = selectedDate ? (calendarData.days[selectedDate] || []) : [];
  const selectedTotal = selectedDate ? (calendarData.totals[selectedDate] || 0) : 0;

  return (
    <div className="w-[280px] flex-shrink-0">
      <div className="sticky top-24">
        <div className="bg-surface rounded-xl border border-line p-4">
          {/* Month header with navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={prevMonth}
              className="text-muted hover:text-foreground transition-colors p-1 rounded hover:bg-surface-hover"
              aria-label="Previous month"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M10 4L6 8L10 12" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-foreground font-display">{monthLabel}</span>
            <button
              onClick={nextMonth}
              className="text-muted hover:text-foreground transition-colors p-1 rounded hover:bg-surface-hover"
              aria-label="Next month"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 4L10 8L6 12" />
              </svg>
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="text-center text-[10px] text-faint font-medium py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, i) => {
              if (!cell) return <div key={`empty-${i}`} />;
              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedDate;
              const hasApps = cell.count > 0;
              const intensity = cell.count >= 3 ? "bg-[rgba(34,197,94,0.3)]" : cell.count > 0 ? "bg-[rgba(34,197,94,0.15)]" : "";

              return (
                <button
                  key={cell.dateStr}
                  onClick={() => setSelectedDate(isSelected ? null : cell.dateStr)}
                  className={[
                    "relative w-full aspect-square flex items-center justify-center rounded-md text-xs transition-all",
                    intensity,
                    isSelected ? "ring-1 ring-pulse text-pulse font-semibold" : "",
                    isToday && !isSelected ? "ring-1 ring-faint" : "",
                    hasApps && !isSelected ? "text-pulse" : "",
                    !hasApps && !isSelected ? "text-muted hover:text-foreground" : "",
                    "hover:bg-surface-hover",
                  ].filter(Boolean).join(" ")}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Loading indicator */}
          {loading && (
            <div className="text-center text-faint text-xs mt-2">Loading...</div>
          )}
        </div>

        {/* Selected date detail panel */}
        {selectedDate && (
          <div className="bg-surface rounded-xl border border-line p-4 mt-3">
            <div className="text-sm font-semibold text-pulse mb-2">
              {formatDateHeader(selectedDate)} &mdash; {selectedTotal} applied
            </div>
            {selectedJobs.length === 0 ? (
              <p className="text-xs text-faint">No applications on this date.</p>
            ) : (
              <div className="space-y-1.5">
                {selectedJobs.map((job, i) => (
                  <div key={i} className="text-xs text-muted">
                    <span className="text-foreground">{job.source_label}</span>
                    {" \u2014 "}
                    {job.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
