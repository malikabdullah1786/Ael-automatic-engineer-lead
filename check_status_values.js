const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://awqnugwdknrpufiyilyd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cW51Z3dka25ycHVmaXlpbHlkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA1MDUyMywiZXhwIjoyMDk4NjI2NTIzfQ.9_Uw5T1AyNkP8TgA954DuDe43v8zBt5YmpXPpf-fwzM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // Let's try inserting with lowercase 'pending', 'in_progress', 'completed'
  // Or let's select check constraints using postgres system catalog
  // Actually, we can use supabase RPC or raw SQL but since we don't have direct SQL interface, 
  // let's try to insert with different status cases.
  const { data: projects } = await supabase.from('active_projects').select('project_id');
  const pid = projects[0].project_id;
  
  const testStatuses = ['To Do', 'Todo', 'Open', 'Backlog', 'pending', 'Pending'];
  for (const status of testStatuses) {
    const { data, error } = await supabase.from('sprint_tasks').insert({
      project_id: pid,
      task_title: `Test ${status}`,
      status: status,
      priority: 'Low',
      due_date: new Date().toISOString()
    }).select();
    console.log(`Status: ${status} | Success: ${!error} | Error:`, error ? error.message : 'none');
    if (data) {
      // clean up
      await supabase.from('sprint_tasks').delete().eq('task_id', data[0].task_id);
    }
  }
}

run();
