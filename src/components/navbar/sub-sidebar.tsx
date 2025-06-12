import SideBarTables from "../views/sidebar-tables";

const SubSideBar = async () => {
  return (
    <div className="relative h-full overflow-auto bg-secondary rounded-lg">
      <div className="scrollable-container-gutter h-[100%] overflow-auto pb-4">
        <SideBarTables />
      </div>
    </div>
  );
};

export default SubSideBar;
