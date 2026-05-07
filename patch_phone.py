with open(r'c:\Users\user\.gemini\antigravity\scratch\applyleave\src\main.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the line numbers
target_line = None
for i, line in enumerate(lines):
    if 'id="edit-password"' in line and 'neu-inset' in line:
        target_line = i
        break

if target_line is None:
    print('ERROR: edit-password line not found')
    exit(1)

print(f'Found edit-password at line {target_line + 1}')
print(f'  Line {target_line+1}: {repr(lines[target_line])}')
print(f'  Line {target_line+2}: {repr(lines[target_line+1])}')
print(f'  Line {target_line+3}: {repr(lines[target_line+2])}')

# Insert after the closing </div> of password section (2 lines after the input)
insert_after = target_line + 2  # After </div>

phone_block = '''\
               <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: #25d366; font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">No. WhatsApp (Untuk Notifikasi)</label>
                 <input type="tel" id="edit-phone" class="neu-inset" placeholder="cth: 0129444295" value="${staff.phone || ''}" style="border: 1px solid rgba(37,211,102,0.2);">
               </div>
'''

lines.insert(insert_after + 1, phone_block)

with open(r'c:\Users\user\.gemini\antigravity\scratch\applyleave\src\main.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f'Phone field inserted after line {insert_after + 1}. Done.')
