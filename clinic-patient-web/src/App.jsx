import { useState, useEffect, useMemo } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from './firebase/firebase.js'
import {
  generateBookingReferenceId,
  downloadAppointmentSlipPdf,
} from './appointmentSlipPdf.js'
import './App.css'

const APPOINTMENTS_COLLECTION = 'appointments'

const SLOT_OPTIONS = [
  { value: '', label: 'Select a time slot' },
  { value: '09:00', label: '9:00 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '11:00', label: '11:00 AM' },
  { value: '14:00', label: '2:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '16:00', label: '4:00 PM' },
]

const BOOKABLE_SLOTS = SLOT_OPTIONS.filter((option) => option.value !== '')

const BOOKING_STEPS = [
  'LMP & scan guide',
  'Preferred date',
  'Time slot',
  'Your details',
  'Confirm',
]

// --- Pregnancy & scan helpers (unchanged logic, used for display) ---

function getPregnancyWeeks(lmpDateStr) {
  if (!lmpDateStr) return null

  const lmp = new Date(`${lmpDateStr}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const diffDays = Math.floor((today - lmp) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return null

  return Math.floor(diffDays / 7)
}

function getRecommendedScan(weeks) {
  if (weeks === null) return null

  if (weeks < 6) {
    return {
      title: 'Early viability scan',
      detail: 'Usually performed from 6 weeks after LMP.',
    }
  }
  if (weeks <= 9) {
    return {
      title: 'Dating / early pregnancy ultrasound',
      detail: 'Confirms due date and fetal heartbeat.',
    }
  }
  if (weeks <= 13) {
    return {
      title: 'NT scan (nuchal translucency)',
      detail: 'Recommended between 11–13 weeks.',
    }
  }
  if (weeks <= 20) {
    return {
      title: 'Anomaly scan (level 2 ultrasound)',
      detail: 'Detailed anatomy review, typically 18–20 weeks.',
    }
  }
  if (weeks <= 28) {
    return {
      title: 'Growth & wellbeing scan',
      detail: 'Checks fetal growth and amniotic fluid.',
    }
  }

  return {
    title: 'Third-trimester wellbeing scan',
    detail: 'Your clinician may suggest additional monitoring.',
  }
}

function getSlotLabel(value) {
  return BOOKABLE_SLOTS.find((s) => s.value === value)?.label || value
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatGeneratedAt(date) {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function getAuthErrorMessage(error) {
  const code = error?.code ?? ''

  const messages = {
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed':
      'Network error. Check your connection and try again.',
    'auth/operation-not-allowed': 'Email sign-in is not enabled.',
  }

  return messages[code] || 'Something went wrong. Please try again.'
}

function Dashboard({ user, onLogout, isLoggingOut }) {
  const displayEmail = user.email || 'Signed in'

  const [view, setView] = useState('home') // 'home' | 'booking' | 'confirmation'
  const [bookingStep, setBookingStep] = useState(1)

  const [patientName, setPatientName] = useState('')
  const [phone, setPhone] = useState('')
  const [lmpDate, setLmpDate] = useState('')
  const [appointmentDate, setAppointmentDate] = useState('')
  const [slot, setSlot] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [lastBooking, setLastBooking] = useState(null)
  const [confirmationSlip, setConfirmationSlip] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const pregnancyWeeks = useMemo(() => getPregnancyWeeks(lmpDate), [lmpDate])
  const recommendedScan = useMemo(
    () => getRecommendedScan(pregnancyWeeks),
    [pregnancyWeeks]
  )

  const formDisabled = isSubmitting || isLoggingOut

  function validateBooking() {
    const errors = {}
    if (!patientName.trim()) errors.patientName = 'Please enter your name.'
    if (!phone.trim()) errors.phone = 'Please enter your phone number.'
    if (!lmpDate) errors.lmpDate = 'Please select your LMP date.'
    if (!appointmentDate) errors.appointmentDate = 'Please select an appointment date.'
    if (!slot) errors.slot = 'Please select a time slot.'

    setFieldErrors(errors)
    setFormError('')
    setSuccessMessage('')
    return Object.keys(errors).length === 0
  }

  function validateCurrentStep() {
    const errors = {}

    if (bookingStep === 1 && !lmpDate) {
      errors.lmpDate = 'Please select your LMP date.'
    }
    if (bookingStep === 2 && !appointmentDate) {
      errors.appointmentDate = 'Please select your preferred appointment date.'
    }
    if (bookingStep === 3 && !slot) {
      errors.slot = 'Please select a time slot.'
    }
    if (bookingStep === 4) {
      if (!patientName.trim()) errors.patientName = 'Please enter your name.'
      if (!phone.trim()) errors.phone = 'Please enter your phone number.'
    }

    setFieldErrors(errors)
    setFormError('')
    return Object.keys(errors).length === 0
  }

  async function isSlotBooked(date, timeSlot) {
    const appointmentsRef = collection(db, APPOINTMENTS_COLLECTION)
    const slotQuery = query(
      appointmentsRef,
      where('appointmentDate', '==', date),
      where('slot', '==', timeSlot)
    )
    const snapshot = await getDocs(slotQuery)
    return !snapshot.empty
  }

  async function handleBookAppointment(event) {
    event.preventDefault()
    if (isSubmitting || isLoggingOut) return
    if (!validateBooking()) return

    setIsSubmitting(true)
    setFormError('')
    setSuccessMessage('')

    try {
      const taken = await isSlotBooked(appointmentDate, slot)
      if (taken) {
        setFormError(
          'This time slot is already booked for that date. Please choose another slot or date.'
        )
        return
      }

      const weeksAtBooking = getPregnancyWeeks(lmpDate)
      const scanAtBooking = getRecommendedScan(weeksAtBooking)
      const bookingReferenceId = generateBookingReferenceId()
      const generatedAt = new Date()

      await addDoc(collection(db, APPOINTMENTS_COLLECTION), {
        patientName: patientName.trim(),
        phone: phone.trim(),
        lmpDate,
        appointmentDate,
        slot,
        status: 'waiting',
        bookingReferenceId,
        userId: user.uid,
        createdAt: serverTimestamp(),
      })

      const slip = {
        bookingReferenceId,
        patientName: patientName.trim(),
        phone: phone.trim(),
        pregnancyWeeks: weeksAtBooking,
        recommendedScan: scanAtBooking?.title || '',
        appointmentDate,
        appointmentDateDisplay: formatDisplayDate(appointmentDate),
        slot,
        slotLabel: getSlotLabel(slot),
        status: 'waiting',
        statusDisplay: 'Waiting for confirmation',
        generatedAt: generatedAt.toISOString(),
        generatedAtDisplay: formatGeneratedAt(generatedAt),
      }

      setConfirmationSlip(slip)
      setLastBooking(slip)
      setPatientName('')
      setPhone('')
      setLmpDate('')
      setAppointmentDate('')
      setSlot('')
      setFieldErrors({})
      setBookingStep(1)
      setView('confirmation')
    } catch {
      setFormError('Could not book appointment. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function startBooking() {
    if (formDisabled) return
    setView('booking')
    setBookingStep(1)
    setFormError('')
    setFieldErrors({})
  }

  function cancelBooking() {
    if (formDisabled) return
    setView('home')
    setBookingStep(1)
    setFormError('')
    setFieldErrors({})
  }

  function goNextStep() {
    if (formDisabled) return
    if (!validateCurrentStep()) return
    setBookingStep((step) => Math.min(step + 1, BOOKING_STEPS.length))
  }

  function goPrevStep() {
    if (formDisabled) return
    setFormError('')
    setFieldErrors({})
    setBookingStep((step) => Math.max(step - 1, 1))
  }

  function goToDashboardFromConfirmation() {
    setView('home')
    setSuccessMessage('Your appointment was booked successfully.')
  }

  function handleDownloadSlip() {
    if (!confirmationSlip) return
    downloadAppointmentSlipPdf(confirmationSlip)
  }

  if (view === 'confirmation' && confirmationSlip) {
    return (
      <div className="scan-app">
        <main className="scan-main confirmation-main">
          <div className="slip-card">
            <div className="slip-logo-area">
              <div className="brand-logo slip-brand-logo" aria-hidden="true">
                <span className="brand-logo-mark">R</span>
              </div>
              <h1 className="slip-title">Booking confirmed</h1>
              <p className="slip-subtitle">
                Your appointment request has been received by Rainbow Scan Centre.
              </p>
            </div>

            <div className="slip-reference-box">
              <p className="slip-ref-label">Booking reference</p>
              <p className="slip-ref-id">{confirmationSlip.bookingReferenceId}</p>
            </div>

            <ul className="slip-details">
              <li>
                <span>Patient name</span>
                <strong>{confirmationSlip.patientName}</strong>
              </li>
              <li>
                <span>Phone</span>
                <strong>{confirmationSlip.phone}</strong>
              </li>
              <li>
                <span>Pregnancy weeks</span>
                <strong>
                  {confirmationSlip.pregnancyWeeks !== null
                    ? `${confirmationSlip.pregnancyWeeks} weeks`
                    : '—'}
                </strong>
              </li>
              <li>
                <span>Recommended scan</span>
                <strong>{confirmationSlip.recommendedScan || '—'}</strong>
              </li>
              <li>
                <span>Appointment date</span>
                <strong>{confirmationSlip.appointmentDateDisplay}</strong>
              </li>
              <li>
                <span>Time slot</span>
                <strong>{confirmationSlip.slotLabel}</strong>
              </li>
              <li>
                <span>Status</span>
                <strong>
                  <span className="status-badge">Waiting</span>
                </strong>
              </li>
            </ul>

            <p className="slip-generated">
              Slip generated: {confirmationSlip.generatedAtDisplay}
            </p>
            <p className="slip-hint">
              Download your slip and show it at reception as proof of booking.
            </p>

            <button
              type="button"
              className="btn btn-primary btn-cta"
              onClick={handleDownloadSlip}
            >
              Download appointment slip (PDF)
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={goToDashboardFromConfirmation}
            >
              Back to dashboard
            </button>
          </div>
        </main>
      </div>
    )
  }

  if (view === 'home') {
    return (
      <div className="scan-app">
        <section className="scan-hero">
          <div className="scan-hero-inner">
            <div className="brand-logo" aria-hidden="true">
              <span className="brand-logo-mark">R</span>
            </div>
            <p className="scan-hero-badge">Premium maternity scan centre</p>
            <h1 className="scan-hero-title">Rainbow Scan Centre</h1>
            <p className="scan-hero-text">
              Elegant, compassionate ultrasound care — with personalised scan guidance
              from your LMP.
            </p>
          </div>
        </section>

        <main className="scan-main">
          <div className="scan-card welcome-card">
            <p className="scan-card-label">Welcome back</p>
            <p className="welcome-email">{displayEmail}</p>
            <p className="welcome-hint">
              Your Rainbow Scan Centre patient portal.
            </p>
          </div>

          <div className="scan-card upcoming-card">
            <div className="card-header-row">
              <h2 className="scan-card-title">Upcoming appointment</h2>
              {lastBooking && (
                <span className="status-badge">Waiting</span>
              )}
            </div>
            {lastBooking ? (
              <ul className="summary-list">
                <li>
                  <span>Reference</span>
                  <strong>{lastBooking.bookingReferenceId}</strong>
                </li>
                <li>
                  <span>Patient</span>
                  <strong>{lastBooking.patientName}</strong>
                </li>
                <li>
                  <span>Date</span>
                  <strong>
                    {lastBooking.appointmentDateDisplay ||
                      formatDisplayDate(lastBooking.appointmentDate)}
                  </strong>
                </li>
                <li>
                  <span>Time</span>
                  <strong>
                    {lastBooking.slotLabel || getSlotLabel(lastBooking.slot)}
                  </strong>
                </li>
                {lastBooking.recommendedScan && (
                  <li>
                    <span>Scan</span>
                    <strong>{lastBooking.recommendedScan}</strong>
                  </li>
                )}
              </ul>
            ) : (
              <p className="summary-empty">
                No upcoming visits scheduled. Book your next scan in a few easy steps.
              </p>
            )}
          </div>

          {successMessage && (
            <p className="form-success scan-banner-success" role="status">
              {successMessage}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary btn-cta"
            onClick={startBooking}
            disabled={formDisabled}
          >
            Book appointment
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onLogout}
            disabled={isLoggingOut || isSubmitting}
          >
            {isLoggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className="scan-app scan-app-booking">
      <header className="booking-topbar">
        <button
          type="button"
          className="btn-text"
          onClick={cancelBooking}
          disabled={formDisabled}
        >
          ← Back
        </button>
        <p className="booking-topbar-title">Rainbow Scan Centre</p>
        <span className="booking-topbar-spacer" />
      </header>

      <div className="step-progress" aria-label="Booking progress">
        {BOOKING_STEPS.map((label, index) => {
          const stepNumber = index + 1
          const isActive = bookingStep === stepNumber
          const isDone = bookingStep > stepNumber
          return (
            <div
              key={label}
              className={`step-dot ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
              title={label}
            >
              <span>{stepNumber}</span>
            </div>
          )
        })}
      </div>
      <p className="step-label">{BOOKING_STEPS[bookingStep - 1]}</p>

      <main className="scan-main booking-main">
        <form className="booking-flow" onSubmit={handleBookAppointment} noValidate>
          {bookingStep === 1 && (
            <section className="scan-card step-card">
              <h2 className="step-title">Last menstrual period (LMP)</h2>
              <p className="step-desc">
                We use your LMP to estimate pregnancy weeks and suggest the right scan.
              </p>
              <div className="field">
                <label htmlFor="lmpDate">LMP date</label>
                <input
                  id="lmpDate"
                  type="date"
                  value={lmpDate}
                  onChange={(e) => setLmpDate(e.target.value)}
                  disabled={formDisabled}
                />
                {fieldErrors.lmpDate && (
                  <p className="field-error">{fieldErrors.lmpDate}</p>
                )}
              </div>

              {lmpDate && pregnancyWeeks !== null && (
                <div className="insight-card">
                  <p className="insight-label">Estimated pregnancy</p>
                  <p className="insight-value">
                    {pregnancyWeeks} {pregnancyWeeks === 1 ? 'week' : 'weeks'}
                  </p>
                </div>
              )}

              {lmpDate && pregnancyWeeks !== null && recommendedScan && (
                <div className="insight-card scan-recommend">
                  <p className="insight-label">Recommended scan</p>
                  <p className="insight-value">{recommendedScan.title}</p>
                  <p className="insight-detail">{recommendedScan.detail}</p>
                </div>
              )}

              {lmpDate && pregnancyWeeks === null && (
                <p className="field-error">LMP date cannot be in the future.</p>
              )}
            </section>
          )}

          {bookingStep === 2 && (
            <section className="scan-card step-card">
              <h2 className="step-title">Preferred appointment date</h2>
              <p className="step-desc">Choose the day you would like to visit Rainbow Scan Centre.</p>
              <div className="field">
                <label htmlFor="appointmentDate">Appointment date</label>
                <input
                  id="appointmentDate"
                  type="date"
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                  disabled={formDisabled}
                />
                {fieldErrors.appointmentDate && (
                  <p className="field-error">{fieldErrors.appointmentDate}</p>
                )}
              </div>
            </section>
          )}

          {bookingStep === 3 && (
            <section className="scan-card step-card">
              <h2 className="step-title">Select a time slot</h2>
              <p className="step-desc">Tap an available slot for your visit.</p>
              <div className="slot-pills" role="group" aria-label="Time slot">
                {BOOKABLE_SLOTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`slot-pill ${slot === option.value ? 'selected' : ''}`}
                    onClick={() => setSlot(option.value)}
                    disabled={formDisabled}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {fieldErrors.slot && <p className="field-error">{fieldErrors.slot}</p>}
            </section>
          )}

          {bookingStep === 4 && (
            <section className="scan-card step-card">
              <h2 className="step-title">Patient details</h2>
              <p className="step-desc">We will use this information to confirm your booking.</p>
              <div className="field">
                <label htmlFor="patientName">Patient name</label>
                <input
                  id="patientName"
                  type="text"
                  autoComplete="name"
                  placeholder="Full name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  disabled={formDisabled}
                />
                {fieldErrors.patientName && (
                  <p className="field-error">{fieldErrors.patientName}</p>
                )}
              </div>
              <div className="field">
                <label htmlFor="phone">Phone number</label>
                <input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="Your phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={formDisabled}
                />
                {fieldErrors.phone && (
                  <p className="field-error">{fieldErrors.phone}</p>
                )}
              </div>
            </section>
          )}

          {bookingStep === 5 && (
            <section className="scan-card step-card">
              <h2 className="step-title">Confirm your booking</h2>
              <p className="step-desc">Please review your details before submitting.</p>
              <ul className="confirm-list">
                <li>
                  <span>LMP date</span>
                  <strong>{formatDisplayDate(lmpDate)}</strong>
                </li>
                <li>
                  <span>Pregnancy weeks</span>
                  <strong>
                    {pregnancyWeeks !== null ? `${pregnancyWeeks} weeks` : '—'}
                  </strong>
                </li>
                <li>
                  <span>Recommended scan</span>
                  <strong>{recommendedScan?.title || '—'}</strong>
                </li>
                <li>
                  <span>Appointment</span>
                  <strong>{formatDisplayDate(appointmentDate)}</strong>
                </li>
                <li>
                  <span>Time slot</span>
                  <strong>{getSlotLabel(slot)}</strong>
                </li>
                <li>
                  <span>Patient</span>
                  <strong>{patientName.trim() || '—'}</strong>
                </li>
                <li>
                  <span>Phone</span>
                  <strong>{phone.trim() || '—'}</strong>
                </li>
              </ul>
            </section>
          )}

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="booking-actions">
            {bookingStep > 1 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={goPrevStep}
                disabled={formDisabled}
              >
                Previous
              </button>
            )}

            {bookingStep < BOOKING_STEPS.length && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={goNextStep}
                disabled={formDisabled}
              >
                Continue
              </button>
            )}

            {bookingStep === BOOKING_STEPS.length && (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={formDisabled}
              >
                {isSubmitting ? 'Submitting…' : 'Confirm booking'}
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}

function AuthPage() {
  const [screen, setScreen] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [formError, setFormError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isLogin = screen === 'login'

  function validate() {
    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()

    const newEmailError = trimmedEmail ? '' : 'Please enter your email.'
    const newPasswordError = trimmedPassword ? '' : 'Please enter your password.'

    setEmailError(newEmailError)
    setPasswordError(newPasswordError)
    setFormError('')

    return !newEmailError && !newPasswordError
  }

  async function handleLogin(event) {
    event.preventDefault()
    if (isLoading) return
    if (!validate()) return

    setIsLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password.trim())
      setFormError('')
    } catch (error) {
      setFormError(getAuthErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleRegister(event) {
    event.preventDefault()
    if (isLoading) return
    if (!validate()) return

    setIsLoading(true)
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password.trim())
      setFormError('')
    } catch (error) {
      setFormError(getAuthErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  function goToRegister() {
    if (isLoading) return
    setScreen('register')
    setEmailError('')
    setPasswordError('')
    setFormError('')
  }

  function goToLogin() {
    if (isLoading) return
    setScreen('login')
    setEmailError('')
    setPasswordError('')
    setFormError('')
  }

  return (
    <div className="auth-page">
      <main className="auth-card">
        <header className="auth-header">
          <div className="auth-logo brand-logo-auth" aria-hidden="true">
            <span className="brand-logo-mark">R</span>
          </div>
          <h1 className="auth-title">Rainbow Scan Centre</h1>
          <p className="auth-subtitle">
            {isLogin
              ? 'Sign in to book and manage your maternity scans.'
              : 'Create your patient account to get started.'}
          </p>
        </header>

        <form
          className="auth-form"
          onSubmit={isLogin ? handleLogin : handleRegister}
          noValidate
        >
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
            {emailError && <p className="field-error">{emailError}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
            {passwordError && <p className="field-error">{passwordError}</p>}
          </div>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={isLoading}>
            {isLoading
              ? isLogin
                ? 'Signing in…'
                : 'Creating account…'
              : isLogin
                ? 'Login'
                : 'Create account'}
          </button>

          {isLogin ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={goToRegister}
              disabled={isLoading}
            >
              Create account
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={goToLogin}
              disabled={isLoading}
            >
              Back to login
            </button>
          )}
        </form>
      </main>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setAuthReady(true)
    })

    return () => unsubscribe()
  }, [])

  async function handleLogout() {
    if (isLoggingOut) return

    setIsLoggingOut(true)
    try {
      await signOut(auth)
    } catch {
      // onAuthStateChanged updates session state
    } finally {
      setIsLoggingOut(false)
    }
  }

  if (!authReady) {
    return (
      <div className="auth-page">
        <main className="auth-card">
          <p className="auth-subtitle">Loading…</p>
        </main>
      </div>
    )
  }

  if (user) {
    return (
      <Dashboard
        user={user}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
      />
    )
  }

  return <AuthPage />
}

export default App
