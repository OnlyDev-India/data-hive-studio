import ExportModal from "../modals/export-modal";

const ExportTable = ({
  columns,
  data,
  selectedData,
}: {
  columns: any;
  data: any;
  selectedData: any;
}) => {
  return (
    <ExportModal columns={columns} data={data} selectedData={selectedData} />
  );
};

export default ExportTable;
