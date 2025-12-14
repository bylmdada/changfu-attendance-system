import * as React from "react"

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className = "", variant = "default", ...props }, ref) => {
    const variants = {
      default: "bg-primary text-primary-foreground hover:bg-primary/80 bg-blue-600 text-white",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 bg-gray-100 text-gray-900",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80 bg-red-600 text-white",
      outline: "text-foreground border border-gray-300 text-gray-900"
    }
    
    return (
      <div
        ref={ref}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variants[variant]} ${className}`}
        {...props}
      />
    )
  }
)
Badge.displayName = "Badge"

export { Badge }
