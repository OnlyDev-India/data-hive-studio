

const SubSideBar = ({children}: {children: React.ReactNode}) => {
  return (
    <div className="relative h-full overflow-auto bg-secondary rounded-lg">
      <div className="h-[100%] overflow-hidden">
        {children}
      </div>
    </div>
  );
};

export default SubSideBar;
