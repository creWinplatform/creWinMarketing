import type {Metadata} from 'next';
import IdentityFlow from '@/components/platform/IdentityFlow';
export const metadata:Metadata={title:'Create Your Workspace',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <IdentityFlow kind="signup"/>;}
