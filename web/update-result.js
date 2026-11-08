// Do not equate a successful serial connection with a successful new boot.
export function installationState(snapshot,expected) {
 if(!snapshot||!expected)return 'waiting';
 if(snapshot.firmware!==expected)return 'rolled_back';
 return snapshot.update_pending===false ? 'confirmed' : 'waiting';
}
