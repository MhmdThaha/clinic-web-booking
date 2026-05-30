import { jsPDF } from 'jspdf'

/**
 * Booking reference format: RSC-YYYYMMDD-4829
 */
export function generateBookingReferenceId() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const random = String(Math.floor(1000 + Math.random() * 9000))

  return `RSC-${year}${month}${day}-${random}`
}

function addLine(doc, label, value, y) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(100, 116, 139)
  doc.text(label, 20, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 27, 75)
  doc.text(String(value), 20, y + 6)

  return y + 16
}

/**
 * Download a professional appointment slip PDF for reception proof.
 */
export function downloadAppointmentSlipPdf(slip) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Header — indigo brand bar
  doc.setFillColor(79, 70, 229)
  doc.rect(0, 0, 210, 42, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Rainbow Scan Centre', 105, 16, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Appointment Confirmation Slip', 105, 26, { align: 'center' })

  doc.setFontSize(9)
  doc.text('Premium Maternity Ultrasound & Scan Centre', 105, 34, { align: 'center' })

  // Reference highlight box
  let y = 52
  doc.setFillColor(238, 242, 255)
  doc.setDrawColor(199, 210, 254)
  doc.roundedRect(15, y - 6, 180, 22, 3, 3, 'FD')

  doc.setTextColor(79, 70, 229)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Booking reference', 20, y + 2)

  doc.setFontSize(14)
  doc.setTextColor(30, 27, 75)
  doc.text(slip.bookingReferenceId, 20, y + 12)

  y += 28

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(30, 27, 75)
  doc.text('Appointment details', 20, y)
  y += 10

  y = addLine(doc, 'Patient name', slip.patientName, y)
  y = addLine(doc, 'Phone number', slip.phone, y)
  y = addLine(
    doc,
    'Pregnancy weeks',
    slip.pregnancyWeeks !== null ? `${slip.pregnancyWeeks} weeks` : '—',
    y
  )
  y = addLine(doc, 'Recommended scan', slip.recommendedScan || '—', y)
  y = addLine(doc, 'Appointment date', slip.appointmentDateDisplay, y)
  y = addLine(doc, 'Time slot', slip.slotLabel, y)
  y = addLine(doc, 'Status', slip.statusDisplay, y)

  y += 4
  doc.setDrawColor(226, 232, 240)
  doc.line(20, y, 190, y)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(`Slip generated: ${slip.generatedAtDisplay}`, 20, y)
  y += 6
  doc.text(
    'Please present this slip at reception on your visit day.',
    20,
    y
  )

  doc.save(`RainbowScan-${slip.bookingReferenceId}.pdf`)
}
