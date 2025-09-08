import ResizableLayout from '@/components/common/resizable-layout'
import React from 'react'

const WorkbenchSidebar = () => {
  return (
    <div className='h-full w-full'>
        <ResizableLayout
            child1={<div>Child 1</div>}
            child2={<div>Child 2</div>}
            activeId="workbenchSidebar"
            direction="vertical"
            collapsible={false}
            isSidebar={false}
            config={"workbenchSidebar"}
            separatorVariant="noSeparatorVertical"
            isSubLayout={true}
        />
    </div>
  )
}

export default WorkbenchSidebar