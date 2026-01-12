import * as React from "react"

interface SelectContextValue {
  value?: string
  displayLabel?: string
  onValueChange?: (value: string, label?: string) => void
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  setDisplayLabel: (label: string) => void
}

const SelectContext = React.createContext<SelectContextValue>({
  isOpen: false,
  setIsOpen: () => {},
  setDisplayLabel: () => {}
})

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}

const Select = ({ value, onValueChange, children }: SelectProps) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [displayLabel, setDisplayLabel] = React.useState<string>('')
  
  const handleValueChange = (newValue: string, label?: string) => {
    if (label) {
      setDisplayLabel(label)
    }
    onValueChange?.(newValue)
  }
  
  return (
    <SelectContext.Provider value={{ 
      value, 
      displayLabel,
      onValueChange: handleValueChange, 
      isOpen, 
      setIsOpen,
      setDisplayLabel
    }}>
      <div className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className = "", children, ...props }, ref) => {
    const { isOpen, setIsOpen } = React.useContext(SelectContext)
    
    return (
      <button
        ref={ref}
        type="button"
        className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-gray-300 bg-white text-gray-900 focus:border-blue-500 focus:ring-blue-500 ${className}`}
        onClick={() => setIsOpen(!isOpen)}
        {...props}
      >
        {children}
        <svg className="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

const SelectValue = ({ placeholder }: { placeholder?: string }) => {
  const { displayLabel, value } = React.useContext(SelectContext)
  // 優先顯示 displayLabel，如果沒有則顯示 value，最後顯示 placeholder
  return <span className="text-gray-900">{displayLabel || value || placeholder}</span>
}

const SelectContent = ({ children }: { children: React.ReactNode }) => {
  const { isOpen, setIsOpen } = React.useContext(SelectContext)
  const contentRef = React.useRef<HTMLDivElement>(null)
  
  // 點擊外部時關閉下拉選單
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
        // 檢查是否點擊的是 trigger 按鈕（由父元素包含）
        const parent = contentRef.current.parentElement
        if (parent && !parent.contains(event.target as Node)) {
          setIsOpen(false)
        }
      }
    }
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, setIsOpen])
  
  // 總是渲染 children 以讓 SelectItem 的 useEffect 可以觸發
  // 但在未開啟時隱藏顯示
  return (
    <div 
      ref={contentRef}
      className={`absolute z-50 mt-1 min-w-full overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md bg-white text-gray-900 border-gray-200 max-h-60 overflow-y-auto ${isOpen ? '' : 'hidden'}`}
    >
      {children}
    </div>
  )
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
}

const SelectItem = ({ value, children }: SelectItemProps) => {
  const { onValueChange, setIsOpen, value: selectedValue, setDisplayLabel } = React.useContext(SelectContext)
  const isSelected = selectedValue === value
  
  // 取得顯示文字（children 可能是字串或 React 節點）
  const getDisplayText = (): string => {
    if (typeof children === 'string') {
      return children
    }
    if (React.isValidElement(children)) {
      const props = children.props as { children?: React.ReactNode }
      if (typeof props.children === 'string') {
        return props.children
      }
    }
    return ''
  }
  
  // 如果是已選擇的項目，初始化時設定 displayLabel
  React.useEffect(() => {
    if (isSelected) {
      const label = getDisplayText()
      if (label) {
        setDisplayLabel(label)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelected])
  
  return (
    <div
      className={`relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none text-gray-900 hover:bg-gray-100 ${isSelected ? 'bg-blue-50' : ''}`}
      onClick={() => {
        const label = getDisplayText()
        setDisplayLabel(label)
        onValueChange?.(value, label)
        setIsOpen(false)
      }}
    >
      {isSelected && (
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
      )}
      {children}
    </div>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
