import OpenedFiles from "@/components/navbar/opened-files";
import { getConnectionDetails } from "@/lib/actions/fetch-data";

const EditorPage = async () => {
  const {dbType} = await getConnectionDetails();
  if (!dbType) {
    return <div>No database type found</div>;
  }
  return <OpenedFiles dbType={dbType} />;
};

export default EditorPage;
