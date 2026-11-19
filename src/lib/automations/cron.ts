/**
 * Human-readable descriptions for five-field cron expressions. Shared by the
 * automations page so the preview, validation message, and deploy toast all
 * describe a schedule the same way.
 */

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const WEEKDAY_NAMES: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
}

export type CronHuman = {
  valid: boolean
  text: string
  parts?: string[]
}

function validField(value: string, min: number, max: number) {
  if (value === "*") return true
  const step = value.match(/^\*\/(\d+)$/)
  if (step) {
    const size = Number(step[1])
    return size > 0 && size <= max
  }
  const parts = value.split(",")
  return parts.every((part) => {
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      return (
        Number(range[1]) >= min && Number(range[2]) <= max && Number(range[1]) <= Number(range[2])
      )
    }
    return /^\d+$/.test(part) && Number(part) >= min && Number(part) <= max
  })
}

function listAnd(items: Array<string | number>) {
  const values = items.map(String)
  if (!values.length) return ""
  if (values.length === 1) return values[0]
  return values.slice(0, -1).join(", ") + " and " + values[values.length - 1]
}

function clockLabel(hour: number, minute: number) {
  const suffix = hour >= 12 ? "PM" : "AM"
  return (
    String(hour % 12 || 12).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + " " + suffix
  )
}

/** Expand a cron field into its values, or null when the field is "*". */
function expandField(value: string, min: number, max: number): number[] | null {
  if (value === "*") return null
  const values = new Set<number>()
  for (const part of value.split(",")) {
    const step = part.match(/^\*\/(\d+)$/)
    const range = part.match(/^(\d+)-(\d+)$/)
    if (step) {
      const size = Number(step[1])
      if (size <= 0) return null
      for (let i = min; i <= max; i += size) values.add(i)
    } else if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) values.add(i)
    } else if (/^\d+$/.test(part)) {
      values.add(Number(part))
    } else {
      return null
    }
  }
  return Array.from(values).sort((a, b) => a - b)
}

function humanTime(minutePart: string, hourPart: string) {
  const minutes = expandField(minutePart, 0, 59)
  const hours = expandField(hourPart, 0, 23)

  if (minutes === null) {
    if (hours === null) return "Every minute"
    if (/^\*\/\d+$/.test(hourPart)) return "Every " + hourPart.split("/")[1] + " hours"
    return (
      "Every minute during the " +
      listAnd(hours.map((h) => clockLabel(h, 0))) +
      (hours.length > 1 ? " hours" : " hour")
    )
  }
  if (hours === null) {
    if (/^\*\/\d+$/.test(minutePart)) return "Every " + minutePart.split("/")[1] + " minutes"
    return "At minute" + (minutes.length > 1 ? "s " : " ") + listAnd(minutes) + " of every hour"
  }
  if (/^\*\/\d+$/.test(minutePart)) {
    return (
      "Every " +
      minutePart.split("/")[1] +
      " minutes during the " +
      listAnd(hours.map((h) => clockLabel(h, 0))) +
      (hours.length > 1 ? " hours" : " hour")
    )
  }

  const times: string[] = []
  hours.forEach((h) => minutes.forEach((m) => times.push(clockLabel(h, m))))
  return "At " + listAnd(times)
}

/** Describe a five-field cron expression in plain English. */
export function humanizeCron(expr: string): CronHuman {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { valid: false, text: "Use 5 fields: minute hour day month weekday" }
  }
  const [min, hour, dom, month, dow] = parts
  if (
    !validField(min, 0, 59) ||
    !validField(hour, 0, 23) ||
    !validField(dom, 1, 31) ||
    !validField(month, 1, 12) ||
    !validField(dow, 0, 7)
  ) {
    return { valid: false, text: "One or more fields are outside their valid range" }
  }

  const timePhrase = humanTime(min, hour)
  let dayPhrase = "every day"

  if (dow !== "*") {
    const range = dow.match(/^(\d)-(\d)$/)
    if (range)
      dayPhrase = WEEKDAY_NAMES[Number(range[1])] + " through " + WEEKDAY_NAMES[Number(range[2])]
    else if (/^\d+(,\d+)*$/.test(dow)) {
      dayPhrase =
        "every " +
        dow
          .split(",")
          .map((d) => WEEKDAY_NAMES[Number(d)])
          .join(" and ")
    } else dayPhrase = "on weekday " + dow
  } else if (dom !== "*") {
    dayPhrase = "on day " + dom + " of the month"
  }

  let monthPhrase = ""
  if (month !== "*") {
    const monthNum = parseInt(month.split(",")[0], 10)
    if (MONTH_NAMES[monthNum]) monthPhrase = " in " + MONTH_NAMES[monthNum]
  }

  return { valid: true, text: timePhrase + ", " + dayPhrase + monthPhrase, parts }
}
