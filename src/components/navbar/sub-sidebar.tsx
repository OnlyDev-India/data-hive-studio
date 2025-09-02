

const SubSideBar = ({children}: {children: React.ReactNode}) => {
  return (
    <div className="relative h-full overflow-auto bg-secondary rounded-lg">
      <div className="scrollable-container-gutter h-[100%] overflow-auto pb-4">
        {children}
      </div>
    </div>
  );
};

export default SubSideBar;
