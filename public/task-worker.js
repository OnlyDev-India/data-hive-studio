// public/task-worker.js

// Helper functions for data conversion
const exportToCSV = (columns, data) => {
  const csvHeader = columns.map((column) => column.name).join(",");
  const csvRows = data.map((row) =>
    columns.map((column) => {
      const value = column.key ? row[column.key] : row[column.column_name];
      return value?.toString() ?? "";
    }).join(",")
  );
  return [csvHeader, ...csvRows].join("\\n");
};

const exportToJSON = (data) => {
  return JSON.stringify(data, null, 2);
};

const exportToExcel = (columns, data) => {
  // For now, return a placeholder since xlsx library isn't available in worker
  return "Excel export not available in worker context";
};

self.onmessage = async (event) => {
  const { task } = event.data;

  self.postMessage({
    type: 'UPDATE',
    task: { id: task.id, status: 'running', progress: 0 },
  });

  try {
    let result = null;
    
    if (task.name === 'Exporting data') {
      const { type, format, data, columns, selectedData, fileName } = task;
      
      self.postMessage({ type: 'UPDATE', task: { id: task.id, progress: 20 } });
      
      let exportData = data;
      let exportColumns = columns;
      
      // Filter data based on type
      if (type === "selected" && selectedData && data) {
        exportData = data.filter((_, index) => selectedData.includes(index));
      }
      
      self.postMessage({ type: 'UPDATE', task: { id: task.id, progress: 50 } });
      
      // Convert data to desired format
      let convertedData = null;
      let mimeType = "text/plain";
      let fileExtension = format;
      
      if (format === 'csv') {
        convertedData = exportToCSV(exportColumns, exportData);
        mimeType = "text/csv;charset=utf-8";
      } else if (format === 'json') {
        convertedData = exportToJSON(exportData);
        mimeType = "application/json";
      } else if (format === 'xlsx') {
        convertedData = exportToExcel(exportColumns, exportData);
        mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
      
      self.postMessage({ type: 'UPDATE', task: { id: task.id, progress: 80 } });
      
      if (convertedData) {
        result = {
          data: convertedData,
          fileName: `${fileName}.${fileExtension}`,
          mimeType: mimeType,
          rowCount: exportData.length
        };
      }
      
    } else {
      // Generic task simulation
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        self.postMessage({
          type: 'UPDATE',
          task: { id: task.id, progress: i },
        });
      }
      result = "Generic task finished successfully!";
    }

    self.postMessage({
      type: 'UPDATE',
      task: { id: task.id, status: 'completed', progress: 100, result },
    });
  } catch (error) {
    self.postMessage({
      type: 'UPDATE',
      task: { id: task.id, status: 'failed', error: error.message },
    });
  }
}; 